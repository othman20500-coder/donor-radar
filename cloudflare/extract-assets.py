import tarfile, pathlib, json, hashlib
archive=pathlib.Path(r'D:\backups\backup-11.15.2026_11-05-44_othmanas.tar.gz')
dest=pathlib.Path.cwd()/'private'
files=[]
with tarfile.open(archive,'r|gz') as tf:
 for member in tf:
  normalized=member.name.replace('\\','/')
  marker='/homedir/donor-radar-v10-team/private/'
  full='/'+normalized.lstrip('./')
  if marker not in full: continue
  relative=full.split(marker,1)[1]
  parts=pathlib.PurePosixPath(relative).parts
  if not parts or any(p in ('.','..') for p in parts): continue
  if relative not in ('catalog.json','build-manifest.json') and not relative.startswith('app/'): continue
  if not member.isfile() or member.size>50*1024*1024: continue
  if pathlib.PurePosixPath(relative).suffix.lower() not in ('.json','.html','.pdf','.pptx','.webp','.png','.jpg','.jpeg','.css','.js','.svg','.txt'): continue
  target=dest.joinpath(*parts)
  target.parent.mkdir(parents=True,exist_ok=True)
  data=tf.extractfile(member).read()
  target.write_bytes(data)
  files.append({'path':relative,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
pathlib.Path('cloudflare/archive-assets-manifest.json').write_text(json.dumps(files,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'extracted_files':len(files),'bytes':sum(f['bytes'] for f in files)}))
