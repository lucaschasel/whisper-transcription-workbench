"""Run with the project's Whisper Python; uses real local decoding."""
import os, sys, tempfile, subprocess, shutil
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
from media import decode_audio, MediaError
import imageio_ffmpeg
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
sample = Path(os.environ.get('TEST_AUDIO', ''))
if not sample.is_file():
    raise SystemExit('Set TEST_AUDIO to a readable WAV or other audio sample before running this check.')
with tempfile.TemporaryDirectory(prefix='personal-mp3-') as folder:
    mp3 = Path(folder, 'sample.mp3')
    subprocess.run([ffmpeg, '-y', '-v', 'error', '-i', str(sample), '-codec:a', 'libmp3lame', '-q:a', '5', str(mp3)], check=True)
    bare = Path(folder, 'extensionless-upload')
    shutil.copyfile(mp3, bare)
    audio, duration = decode_audio(bare, ffmpeg)
    assert 8 < duration < 12 and len(audio) > 100000
    try:
        decode_audio(bare, ffmpeg, max_seconds=1)
        raise AssertionError('duration limit not enforced')
    except MediaError as exc:
        assert exc.code == 'DURATION_LIMIT'
    bare.write_bytes(b'invalid mp3 content')
    try:
        decode_audio(bare, ffmpeg)
        raise AssertionError('invalid file accepted')
    except MediaError as exc:
        assert exc.code == 'INVALID_MEDIA'
    print('PASS: real VBR MP3, extensionless decoding, duration limit, invalid media')
