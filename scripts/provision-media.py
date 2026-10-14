"""ตรวจ Storage จริงด้วย configuration ทาง getpass ไม่เก็บ secret ในไฟล์"""
import getpass
import json
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from server import create_app
from server.media import BUCKET, MAX_IMAGE_BYTES, optimized_image, storage_request

config=json.loads(getpass.getpass('Configuration (hidden): ') if sys.stdin.isatty() else sys.stdin.read())
app=create_app(config)
with app.app_context():
    response=storage_request('GET','bucket/'+BUCKET)
    if response.is_error:
        response=storage_request('POST','bucket',body={'id':BUCKET,'name':BUCKET,'public':True,'file_size_limit':MAX_IMAGE_BYTES,'allowed_mime_types':['image/webp']})
        if response.is_error: raise SystemExit('Bucket provisioning failed: '+str(response.status_code))
    raw=optimized_image((Path(__file__).resolve().parent.parent/'public/static/images/alyzyus-hero.webp').read_bytes())
    name='products/alyzyus-reference-'+uuid4().hex+'.webp'
    result=storage_request('POST','object/'+BUCKET+'/'+name,content=raw)
    if result.is_error: raise SystemExit('Storage upload failed: '+str(result.status_code))
    print(json.dumps({'publicMediaBucket':True,'uploadedReferenceBytes':len(raw),'imageUrl':app.config['SUPABASE_URL']+'/storage/v1/object/public/'+BUCKET+'/'+name}),flush=True)
