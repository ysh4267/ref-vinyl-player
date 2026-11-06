# Vinyl

A rebuild of a spinning record with a wheel of note lines, matched to the reference video.

Reference: [godly.design 616 video](https://cdn.godly.design/posts/616.mp4)

## Interaction

- The play button starts the record spinning and moves the tonearm inward. A red marker on the outer ring follows the progress.
- The note lines sit on a wheel that turns around the record center. When a line ends, the wheel turns the next line to the middle; lines above and below tilt and blur.
- The note being played lights up in a color box per note name and grows slightly. The previous couple of boxes fade out behind it.
- A small square arcs from note to note, landing on each one as it plays and changing color on the way.
- The ticks outside the ring grow longer and redder from the middle as notes play.
- The buttons below go to the previous or next line and pause. There is no sound.

## How it was made

- The video (1920x1198) was measured every 0.2s for the line order and tempo, the record speed (40 degrees per second), the tonearm angle, the angle between lines (13 degrees) and the note colors. Coordinates are video pixels.
- The record and note lines hug the left edge and fill the window height; title, transport and time stick to the window edges.
- The record pattern is noise-based pink, violet and orange swirls smeared around the circle, generated once. The label artwork and tonearm are redrawn in a similar style.
- Notes use JetBrains Mono; everything else uses Inter.
- No build step: just `index.html`, `style.css` and `main.js`.

## URL options

- `?demo`: starts playing right away and loops from the start at the end (for the gallery preview).
