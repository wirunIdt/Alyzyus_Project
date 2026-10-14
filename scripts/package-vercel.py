"""Emit a safe deployment manifest or one allowlisted file for the Vercel connector.

Usage: python scripts/package-vercel.py [relative-file]
No environment files, customer records, credentials, or archived source are packaged.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROOT_FILES = ['app.py', 'requirements.txt', 'vercel.json', 'pyproject.toml']
TEMPLATES = ['base.html','macros.html','index.html','shop.html','product.html','admin.html','checkout.html','account.html','tracking.html','help.html','error.html','auth_callback.html']

def files():
    result = [ROOT / name for name in ROOT_FILES if (ROOT / name).is_file()]
    result += [ROOT/'templates'/name for name in TEMPLATES if (ROOT/'templates'/name).is_file()]
    result += list((ROOT/'server').rglob('*.py'))
    assets = ROOT/'public'/'static'
    if not assets.is_dir():
        assets = ROOT/'static'
    result += list((assets/'js').glob('*.js'))
    result += list((assets/'css').glob('*.css'))
    result += [ROOT/'data'/'demo-products.json', assets/'images'/'alyzyus-hero.webp', assets/'images'/'favicon.svg',assets/'queue3d.html']
    return {p.relative_to(ROOT).as_posix():p for p in result if p.is_file()}

if __name__ == '__main__':
    allowed = files()
    if len(sys.argv)>1:
        name=sys.argv[1]
        if name not in allowed:
            raise SystemExit('File is not in the deployment allowlist')
        content=allowed[name].read_bytes()
        print(json.dumps({'file':name,'sha':hashlib.sha1(content).hexdigest(),'size':len(content),'data':base64.b64encode(content).decode('ascii')}))
    else:
        print(json.dumps([{'file':name,'sha':hashlib.sha1(path.read_bytes()).hexdigest(),'size':path.stat().st_size} for name,path in sorted(allowed.items())]))
