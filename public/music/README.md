# The game's music

`sea.ogg` (and `sea.mp3`, the same piece for browsers that do not play Ogg) is the one piece of music in the game:
two and a half minutes, cut so that its end runs into its start.

It was generated for this game on 2026-11-12 with Google's Lyria 3 music model (`google/lyria-3-pro-preview`,
through OpenRouter), from this description:

> Background music for a video game: cozy fishing afternoon on a calm sea, gentle fingerpicked nylon guitar, soft
> kalimba melody, warm electric piano, light brushed percussion and shaker, slow and unhurried around 76 bpm,
> sunny, relaxed, a little nostalgic, pixel-art village game feel, no vocals

It is played by `src/music.js`. To use another piece, replace both files.
