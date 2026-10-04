#!/usr/bin/env node
/**
 * Synthetic load test for the StreamBird relay path: N fake "hosts" publish
 * a test pattern over WHIP to MediaMTX, which runs the exact same ffmpeg
 * relay command production uses (MediaMtxService.buildRunOnReady) and pushes
 * to RTMP sinks YOU control. Watch the VPS (CPU, network, `docker stats`)
 * while it ramps to find the real capacity knee. See README.md.
 *
 * Usage (after `npm run build`, from a DIFFERENT machine than the VPS):
 *   MTX_API_URL=https://mtx-api.example.com MTX_API_USER=.. MTX_API_PASSWORD=.. \
 *   WHIP_BASE_URL=https://mediamtx.example.com SINK_RTMP_URL=rtmp://sink.example.com/live \
 *   node scripts/load-test/load-test.js --streams 10 --dests 3 --quality hd --minutes 5 --yes
 *
 * Without --yes it only prints the plan.
 */
const { spawn, spawnSync } = require('child_process');
const { MediaMtxService } = require('../../dist/relay/mediamtx.service');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const env = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`Missing env var ${k}`); process.exit(2); }
  return v.replace(/\/$/, '');
};

const QUALITY = { sd: ['640x360', 1000], hd: ['1280x720', 3000], fhd: ['1920x1080', 6000] };
const streams = Number(arg('streams', 5));
const dests = Number(arg('dests', 3));
const quality = arg('quality', 'hd');
const minutes = Number(arg('minutes', 3));
const rampSeconds = Number(arg('ramp', 5));
if (!QUALITY[quality]) { console.error('--quality must be sd, hd or fhd'); process.exit(2); }
const [size, kbps] = QUALITY[quality];

const MTX_API = env('MTX_API_URL');
const WHIP_BASE = env('WHIP_BASE_URL');
const SINK = env('SINK_RTMP_URL');
const auth = 'Basic ' + Buffer.from(`${process.env.MTX_API_USER ?? ''}:${process.env.MTX_API_PASSWORD ?? ''}`).toString('base64');

// Never aim synthetic traffic at a real platform.
if (/twitch|youtube|facebook|fbcdn|instagram|kick\.com|tiktok|linkedin/i.test(SINK)) {
  console.error('SINK_RTMP_URL must be an RTMP server you control, not a real platform.');
  process.exit(2);
}

const egressMbps = (streams * dests * (kbps + 128)) / 1000;
console.log(`Plan: ${streams} streams x ${dests} destinations, ${quality} (${size}, ${kbps} kbps)`);
console.log(`  VPS ingress ~${((streams * (kbps + 128)) / 1000).toFixed(0)} Mbps, egress to sink ~${egressMbps.toFixed(0)} Mbps, ${minutes} min, ramp ${rampSeconds}s/stream`);
console.log(`  This machine needs ~${((streams * (kbps + 128)) / 1000).toFixed(0)} Mbps upload and ffmpeg >= 7.1 (WHIP muxer).`);
if (!flag('yes')) { console.log('Dry run. Add --yes to start.'); process.exit(0); }

const probe = spawnSync('ffmpeg', ['-hide_banner', '-muxers'], { encoding: 'utf8' });
if (!/whip/i.test(probe.stdout || '')) { console.error('This ffmpeg has no WHIP muxer (need >= 7.1).'); process.exit(2); }

// buildRunOnReady only needs the logger, not HTTP/config.
const relay = new MediaMtxService({}, { get: () => undefined });
const runId = Date.now().toString(36);
const children = [];
const paths = [];
let stopping = false;

async function api(method, path, body) {
  const res = await fetch(`${MTX_API}${path}`, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res;
}

async function startOne(i) {
  const name = `loadtest-${runId}-${i}`;
  const rtmpDests = Array.from({ length: dests }, (_, d) => `${SINK}/${name}-${d}`);
  await api('POST', `/v3/config/paths/add/${name}`, {
    source: 'publisher',
    runOnReady: relay.buildRunOnReady(rtmpDests),
    runOnReadyRestart: true,
  });
  paths.push(name);
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-re',
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'baseline',
    '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-g', '60', '-pix_fmt', 'yuv420p',
    '-c:a', 'libopus', '-b:a', '64k',
    '-f', 'whip', `${WHIP_BASE}/${name}/whip`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  ff.on('exit', (code) => { if (!stopping) console.log(`  publisher ${i} exited (code ${code})`); });
  children.push(ff);
}

async function report() {
  try {
    const res = await api('GET', '/v3/paths/list?itemsPerPage=1000');
    const items = (await res.json()).items ?? [];
    const mine = items.filter((p) => p.name.startsWith(`loadtest-${runId}-`));
    const ready = mine.filter((p) => p.ready).length;
    const readers = mine.reduce((n, p) => n + (p.readers?.length ?? 0), 0);
    console.log(`[${new Date().toISOString().slice(11, 19)}] paths ready ${ready}/${streams}, readers ${readers} (want ${streams} -- one ffmpeg relay each)`);
  } catch (e) { console.log(`  report failed: ${e.message}`); }
}

async function stop() {
  if (stopping) return;
  stopping = true;
  console.log('Stopping and cleaning up...');
  children.forEach((c) => c.kill('SIGINT'));
  await Promise.allSettled(paths.map((p) => api('DELETE', `/v3/config/paths/delete/${p}`)));
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

(async () => {
  for (let i = 0; i < streams && !stopping; i++) {
    await startOne(i);
    console.log(`started ${i + 1}/${streams}`);
    await report();
    await new Promise((r) => setTimeout(r, rampSeconds * 1000));
  }
  const iv = setInterval(report, 10_000);
  setTimeout(() => { clearInterval(iv); void stop(); }, minutes * 60_000);
})().catch((e) => { console.error(e); void stop(); });
