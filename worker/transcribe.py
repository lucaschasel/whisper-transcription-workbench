"""Isolated real Whisper inference. No mock results and no automatic model download."""
import argparse, os, sys, json, time, threading, subprocess, re
from pathlib import Path
p=argparse.ArgumentParser()
for name in ('input','output','model','language','prompt','parent'): p.add_argument('--'+name, required=True)
a=p.parse_args()
def emit(**obj): print(json.dumps(obj,ensure_ascii=False),flush=True)
def watchdog():
    if os.name=='nt':
        import ctypes
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
        kernel.OpenProcess.restype=wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
        handle=kernel.OpenProcess(0x00100000,False,int(a.parent))
        if not handle: os._exit(9)
        kernel.WaitForSingleObject(handle,0xFFFFFFFF)
        os._exit(9)
    else:
        while True:
            if os.getppid()!=int(a.parent): os._exit(9)
            time.sleep(1)
threading.Thread(target=watchdog,daemon=True).start()
started=time.monotonic()
try:
    emit(stage='检查音视频')
    import imageio_ffmpeg
    ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
    from media import decode_audio, MediaError
    emit(stage='正在解码音频')
    audio, seconds=decode_audio(a.input, ffmpeg)
    emit(stage='加载本地模型')
    import torch, whisper
    from whisper.utils import get_writer
    device='cuda' if torch.cuda.is_available() else 'cpu'
    model=whisper.load_model(a.model,device=device)
    emit(stage='正在转写')
    result=model.transcribe(audio,language=None if a.language=='auto' else a.language,task='transcribe',fp16=device=='cuda',verbose=False,initial_prompt=a.prompt.strip() or None)
    emit(stage='生成文字与字幕')
    Path(a.output).mkdir(parents=True,exist_ok=True)
    for ext in ('txt','srt','vtt','json'): get_writer(ext,a.output)(result,'transcript',{})
    Path(a.output,'metadata.json').write_text(json.dumps({'model':Path(a.model).stem,'device':device,'language':result.get('language'),'elapsedSeconds':round(time.monotonic()-started,2),'durationSeconds':seconds},ensure_ascii=False),encoding='utf-8')
except Exception as exc:
    message=str(exc)
    if hasattr(exc, 'code'): emit(error=message,code=exc.code)
    elif 'out of memory' in message.lower(): emit(error='显存不足，请关闭其他占用 GPU 的程序后重试。',code='OUT_OF_MEMORY')
    else: emit(error='推理失败，请检查模型、依赖或媒体文件。',code='INFERENCE_FAILED')
    print(message,file=sys.stderr)
    sys.exit(1)
