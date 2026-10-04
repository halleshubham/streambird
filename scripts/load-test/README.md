# Relay load test

Finds the real capacity of the VPS by running N synthetic publishers through the
same MediaMTX + ffmpeg relay path production uses.

## What it needs

- `npm run build` first (the script loads the compiled `MediaMtxService`).
- A **second machine** to run it from, with ~3.2 Mbps upload per stream (HD) and
  **ffmpeg 7.1+** (the WHIP muxer). Running it on the VPS itself would test CPU
  but not the network.
- An **RTMP sink you control** that accepts any stream key, e.g. another MediaMTX
  (default config accepts RTMP publishes on :1935) or nginx-rtmp, on a host whose
  downlink can absorb `streams x dests x 3.2 Mbps`. The script refuses sinks that
  look like real platforms.
- The MediaMTX API URL and credentials (`MEDIAMTX_API_*` in Coolify) and the
  public WHIP base URL.

## Run

```bash
export MTX_API_URL=https://<mtx-api-host> MTX_API_USER=... MTX_API_PASSWORD=...
export WHIP_BASE_URL=https://<mediamtx-host> SINK_RTMP_URL=rtmp://<sink-host>/live

node scripts/load-test/load-test.js --streams 10 --dests 3 --quality hd --minutes 5        # dry run (prints the plan)
node scripts/load-test/load-test.js --streams 10 --dests 3 --quality hd --minutes 5 --yes  # go
```

Ramp in steps (5, 10, 20, 30...) and, at each step, watch on the VPS: CPU
(`docker stats` / Coolify metrics / `htop`), network out (`nload`/`iftop`), and
the script's `paths ready` / `readers` lines. The knee is where CPU passes ~70%,
the NIC nears its limit, or `readers` stops matching `streams` (relays failing).
Compare with the estimates: ~10% of a core and `dests x 3.2 Mbps` per HD stream.
Ctrl+C stops everything and deletes the test paths.

Also test the failure case: while streams are running, stop the publishers
(or `--minutes` ends) and watch CPU when many streams drop to the slate at once.
