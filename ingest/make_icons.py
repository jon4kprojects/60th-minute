#!/usr/bin/env python3
"""Render the 60th Minute app icons. Drawn at 4x and downsampled for clean edges."""
from PIL import Image, ImageDraw, ImageFont
import os, math

BASE=(8,9,12); TRACK=(37,41,53); PAPER=(247,248,250)
STOPS=[(0.0,(255,176,32)),(0.45,(255,122,24)),(1.0,(255,61,46))]

def grad(t):
    for i in range(len(STOPS)-1):
        a,ca=STOPS[i]; b,cb=STOPS[i+1]
        if a<=t<=b:
            f=(t-a)/(b-a)
            return tuple(round(ca[j]+(cb[j]-ca[j])*f) for j in range(3))
    return STOPS[-1][1]

def font(px):
    for path,idx in [("/System/Library/Fonts/SFNS.ttf",0),
                     ("/System/Library/Fonts/HelveticaNeue.ttc",1),
                     ("/System/Library/Fonts/Helvetica.ttc",1)]:
        if os.path.exists(path):
            try:
                f=ImageFont.truetype(path,px,index=idx)
                try: f.set_variation_by_name("Bold")
                except Exception: pass
                return f
            except Exception: continue
    return ImageFont.load_default()

def icon(size, ring=True, pad_bg=True):
    S=size*4
    img=Image.new("RGB",(S,S),BASE); d=ImageDraw.Draw(img)
    if pad_bg:   # warm bloom from the top, matching the app
        for y in range(int(S*0.62)):
            t=y/(S*0.62); a=(1-t)**2*0.30
            d.line([(0,y),(S,y)], fill=tuple(round(BASE[i]+(255,122,24)[i]*a*0.75) for i in range(3)))
    if ring:
        r=int(S*0.358); cx=cy=S//2; w=int(S*0.075)
        d.ellipse([cx-r,cy-r,cx+r,cy+r], outline=TRACK, width=w)
        # 60 of 90 minutes = 240 degrees, clockwise from twelve o'clock
        start,sweep=-90,240
        steps=240
        for i in range(steps):
            a0=start+sweep*i/steps; a1=start+sweep*(i+1)/steps+0.6
            d.arc([cx-r,cy-r,cx+r,cy+r], a0, a1, fill=grad(i/steps), width=w)
        for ang,t in ((start,0.0),(start+sweep,1.0)):   # round the caps
            x=cx+r*math.cos(math.radians(ang)); y=cy+r*math.sin(math.radians(ang))
            d.ellipse([x-w/2,y-w/2,x+w/2,y+w/2], fill=grad(t))
        fs=int(S*0.30); txt_y=cy
    else:
        fs=int(S*0.46); txt_y=S//2
    f=font(fs)
    num,prime="60","′"
    wn=d.textlength(num,font=f); wp=d.textlength(prime,font=f)
    total=wn+wp; x=(S-total)/2
    bb=d.textbbox((0,0),num,font=f); h=bb[3]-bb[1]
    y=txt_y-h/2-bb[1]
    d.text((x,y),num,font=f,fill=PAPER)
    d.text((x+wn,y),prime,font=f,fill=grad(0.5))
    return img.resize((size,size), Image.LANCZOS)

for size,ring in [(180,True),(512,True),(32,False),(64,False)]:
    p=f"app/icon-{size}.png"
    icon(size,ring=ring).save(p)
    print(f"  {p}  {os.path.getsize(p):,} bytes")
