# Architecture Note

## Media fixture provenance and licence

The committed media fixtures are development inputs, not application output. The development seed registers them as sources; the application prepares renditions and serves them through `GET /api/media/[assetId]/[rendition]`, which re-authorises every request — playback, poster, caption track, transcript and byte range — so no original ever sits behind a permanent public URL. Preparation uses `file-type` and `mediabunny` only. It is local processing, not production transcoding or scanning, and no surface claims otherwise.

### `apps/dashboard/public/fixtures/media/sample-h264.mp4`

| Property            | Value                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring route     | Route 2 of assumption A6: a published, openly licensed clip committed byte-for-byte. No encoder produced it, and the application declares no encoder dependency.                             |
| Source              | `https://mdn.github.io/shared-assets/videos/flower.mp4` (MDN shared assets; the same file is published in the MDN `interactive-examples` repository under `live-examples/media/cc0-videos/`) |
| Licence             | CC0 1.0 public-domain dedication                                                                                                                                                             |
| Bytes               | 1,128,375                                                                                                                                                                                    |
| SHA-256             | `0cd83d944a6ca7822b4a8306cecc60a36e859b041f6702c6a1ad9ead78924451`                                                                                                                           |
| Container           | MP4 (ISO base media file format, `ftyp` brand `mp42`, compatible brands `mp42 mp41 isom avc1`)                                                                                               |
| Video               | H.264 (`avc`), coded and displayed 960 × 540, rotation 0, 29.97 fps                                                                                                                          |
| Audio               | AAC, 48 kHz, 2 channels                                                                                                                                                                      |
| Duration            | 5.056 s as reported by the media inspector; 5.055 s container duration                                                                                                                       |
| Profile             | Within the admitted video profile: MP4 with H.264 video and AAC audio, at most 100 MiB, at most 180 s, at most 1920 × 1080 after rotation is applied                                         |
| Runtime requirement | None beyond the browser's own decoder. Playback needs no encoder, no external binary and no server-side transcode.                                                                           |

**How the values above were measured.** Content typing with `file-type` 22.3.0 returns `video/mp4` from the magic bytes, so the type never rests on the `.mp4` extension. Container, duration, codecs, dimensions and rotation come from `mediabunny` 1.66.2. Playback was verified in a real browser: the clip loads its metadata, plays in real time, seeks to an exact position mid-playback and from a paused load, and runs to its end with no media error, served with `206 Partial Content` so seeking follows the same byte-range path the application's media route provides.

**Tags in the committed original, and why they matter.** The source carries the source-encoder tags `handler_name: "L-SMASH Video Handler"`, `encoder: "AVC Coding"`, `language: "und"` and a `creation_time` of 2018-03-07. The fixture keeps the source bytes unmodified; the video pipeline produces a copy-remux with no descriptive tags and verifies the served rendition before admitting it, so these source tags never reach a reader. As assumption A7 records, container creation and modification timestamps may survive a copy-remux, and the pipeline rejects a rendition that still reports a descriptive tag rather than serving it.
