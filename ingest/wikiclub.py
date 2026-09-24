import json, urllib.request, urllib.parse, re
from html.parser import HTMLParser
UA="FootballQuizMVP/0.1 (research)"
def api(p):
    u="https://en.wikipedia.org/w/api.php?"+urllib.parse.urlencode(p)
    r=urllib.request.Request(u,headers={"User-Agent":UA})
    with urllib.request.urlopen(r,timeout=90) as x: return json.load(x)
class T(HTMLParser):
    def __init__(s): super().__init__(); s.tables=[]; s.cur=None; s.row=None; s.cell=None
    def handle_starttag(s,t,a):
        if t=='table': s.cur=[]
        elif t=='tr' and s.cur is not None: s.row=[]
        elif t in ('td','th') and s.row is not None: s.cell=[]
    def handle_endtag(s,t):
        if t=='table' and s.cur is not None: s.tables.append(s.cur); s.cur=None
        elif t=='tr' and s.row is not None:
            if s.row: s.cur.append(s.row)
            s.row=None
        elif t in ('td','th') and s.cell is not None:
            s.row.append(re.sub(r'\s+',' ',''.join(s.cell)).strip()); s.cell=None
    def handle_data(s,d):
        if s.cell is not None: s.cell.append(d)

def club_players(title):
    d=api({"action":"parse","page":title,"prop":"text","format":"json","formatversion":"2"})
    if "parse" not in d: return None
    p=T(); p.feed(d["parse"]["text"])
    for tb in sorted(p.tables,key=len,reverse=True):
        hdr=[h.lower() for h in tb[0]]
        if 'player' not in hdr: continue
        def col(*names):
            for n in names:
                if n in hdr: return hdr.index(n)
            return None
        ci,ct,cg=col('player'),col('total','apps','appearances'),col('goals')
        if ct is None: continue
        out=[]
        for r in tb[1:]:
            if len(r)<=max(ci,ct): continue
            try: apps=int(re.sub(r'\D','',r[ct]) or 0)
            except: continue
            if not apps: continue
            goals=0
            if cg is not None and cg<len(r):
                try: goals=int(re.sub(r'\D','',r[cg]) or 0)
                except: goals=0
            out.append((r[ci],apps,goals))
        if len(out)>30: return out
    return None
