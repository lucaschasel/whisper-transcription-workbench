"""Decode by audio content, including extensionless uploads and VBR MP3."""
import subprocess
import numpy as np

class MediaError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code

def decode_audio(filename, ffmpeg, max_seconds=1800):
    try:
        result = subprocess.run(
            [ffmpeg, '-nostdin', '-v', 'error', '-i', str(filename),
             '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000',
             '-t', str(max_seconds + 1), '-f', 's16le', 'pipe:1'],
            capture_output=True, timeout=120)
    except subprocess.TimeoutExpired as exc:
        raise MediaError('DECODE_TIMEOUT', '音频解码超时，请压缩或分段后重试。') from exc
    if result.returncode or not result.stdout:
        raise MediaError('INVALID_MEDIA', '无法读取音轨。请确认文件可以正常播放，或重新导出为 MP3/WAV 后上传。')
    audio = np.frombuffer(result.stdout, np.int16).astype(np.float32) / 32768.0
    duration = len(audio) / 16000
    if duration > max_seconds:
        raise MediaError('DURATION_LIMIT', '音频超过 30 分钟，请分段后再上传。')
    return audio, duration
