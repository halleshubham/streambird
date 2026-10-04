import { ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { MediaMtxService } from '../../src/relay/mediamtx.service';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/**
 * The "technical difficulties" slate, end to end: the exact shell command we
 * hand MediaMTX is run under `sh`, fetching the clip from a server that
 * (like Cloudflare in front of production) does NOT support Range, and its
 * RTMP output is received by a real ffmpeg sink. The clip is 10s, so >10s of
 * continuous frames proves it loops.
 */
(hasFfmpeg ? describe : describe.skip)('slate: loops past the clip length without Range support', () => {
  let server: http.Server;
  let httpPort: number;
  const publicDir = path.join(__dirname, '../../web-app/public');

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const file = path.join(publicDir, path.basename(req.url ?? ''));
      if (!fs.existsSync(file)) return void res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'application/octet-stream' }); // no Accept-Ranges, ignores Range
      fs.createReadStream(file).pipe(res);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    httpPort = (server.address() as net.AddressInfo).port;
  });
  afterAll(() => void server.close());

  it('streams continuously for 14s from a 10s clip', async () => {
    const rtmpPort = await new Promise<number>((resolve) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
    const svc = new MediaMtxService({} as any, { get: (k: string) => (k === 'publicBaseUrl' ? `http://127.0.0.1:${httpPort}` : undefined) } as any);
    const command: string = (svc as any).buildSlateCommand([`rtmp://127.0.0.1:${rtmpPort}/live/k`], (svc as any).slateUrl);
    expect(command).toMatch(/^if ffmpeg .*; then exec ffmpeg .*stream_loop.*; else exec ffmpeg .*libx264.*; fi$/);

    let sinkLog = '';
    const sink: ChildProcess = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-listen', '1', '-i', `rtmp://127.0.0.1:${rtmpPort}/live/k`, '-t', '14', '-f', 'null', '-']);
    sink.stderr!.on('data', (d) => (sinkLog += d));
    await new Promise((r) => setTimeout(r, 1500)); // let the listener come up

    const slate = spawn('sh', ['-c', command], { env: { ...process.env, MTX_PATH: 'e2e-slate' } });
    await new Promise<void>((resolve) => {
      sink.on('exit', () => resolve());
      setTimeout(() => sink.kill('SIGKILL'), 40_000);
    });
    slate.kill('SIGKILL');

    const frames = [...sinkLog.matchAll(/frame=\s*(\d+)/g)].map((m) => Number(m[1])).pop() ?? 0;
    // 14s at 30fps ~ 420 frames; one pass of the clip is only 300.
    expect(frames).toBeGreaterThan(360);
  }, 70_000);
});
