glitch-slate.mp4 is generated from glitch-slate.png (720p30, GOP 60, 10s = 5 whole GOPs so it loops cleanly):

ffmpeg -y -loop 1 -framerate 30 -i glitch-slate.png -t 10 -c:v libx264 -preset slow -tune stillimage \
  -pix_fmt yuv420p -profile:v main -r 30 -g 60 -keyint_min 60 -sc_threshold 0 \
  -b:v 1500k -maxrate 1500k -bufsize 3000k -an -movflags +faststart glitch-slate.mp4

Regenerate it whenever the PNG changes.

glitch-slate-portrait.mp4 is the same for 9:16 (720x1280) streams, so a vertical stream's slate has the same shape as the stream:

ffmpeg -y -loop 1 -framerate 30 -i glitch-slate-portrait.png -t 10 -c:v libx264 -preset slow -tune stillimage \
  -pix_fmt yuv420p -profile:v main -r 30 -g 60 -keyint_min 60 -sc_threshold 0 \
  -b:v 1500k -maxrate 1500k -bufsize 3000k -an -movflags +faststart glitch-slate-portrait.mp4
