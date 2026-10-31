#!/usr/bin/env python3
"""Builds assets/audio/audiopack.js from source recordings.

Every clip is trimmed, resampled, loudness-normalised, made seamlessly
loopable (equal-power crossfade) when it is a loop, encoded to Ogg Vorbis and
embedded as base64 so the simulator also works when index.html is opened
directly from disk (file://), where fetch()/XHR of local files is blocked.

Usage: python3 tools/build_audio.py <dir containing fgdata/ and fg/ clones>
Sources and licences are listed in ATTRIBUTION.md.
"""
import sys, os, base64, json, subprocess, tempfile
import numpy as np, soundfile as sf
from scipy.signal import resample_poly
from math import gcd
import imageio_ffmpeg

SRC = sys.argv[1]
OUT_JS = os.path.join(os.path.dirname(__file__), '..', 'assets', 'audio', 'audiopack.js')
FF = imageio_ffmpeg.get_ffmpeg_exe()

FG = 'fg/'
R = {
 'fgdata':  'https://gitlab.com/flightgear/fgdata',
 'c172p':   'https://github.com/c172p-team/c172p',
 '727':     'https://github.com/FGMEMBERS/727-230',
 '737':     'https://github.com/FGMEMBERS/737-800',
 '747':     'https://github.com/FGMEMBERS/747-8i',
 'a320':    'https://github.com/FGMEMBERS/A320-family',
 'crj':     'https://github.com/FGMEMBERS/CRJ700-family',
 'citx':    'https://github.com/FGMEMBERS/CitationX',
 'ec135':   'https://github.com/FGMEMBERS/ec135',
 'ec145':   'https://github.com/FGMEMBERS/EC145',
 'uh1':     'https://github.com/FGMEMBERS/UH-1',
 'md11':    'https://github.com/Octal450/IDG-MD-11',
 'alpha':   'https://github.com/FGMEMBERS/Alphajet',
 'pc12':    'https://github.com/FGMEMBERS/PC-12',
}
P = {
 'fgdata': 'fgdata/', 'c172p': FG+'c172p-team_c172p/', '727': FG+'FGMEMBERS_727-230/', '737': FG+'FGMEMBERS_737-800/',
 '747': FG+'FGMEMBERS_747-8i/', 'a320': FG+'FGMEMBERS_A320-family/', 'crj': FG+'FGMEMBERS_CRJ700-family/',
 'citx': FG+'FGMEMBERS_CitationX/', 'ec135': FG+'FGMEMBERS_ec135/', 'ec145': FG+'FGMEMBERS_EC145/', 'uh1': FG+'FGMEMBERS_UH-1/',
 'md11': FG+'Octal450_IDG-MD-11/', 'alpha': FG+'FGMEMBERS_Alphajet/', 'pc12': FG+'FGMEMBERS_PC-12/',
}

# id: (repo, path, kind, start, length, sr, quality)   kind: loop | once
C = {
 # --- high-bypass turbofan (wide-body) : FL2070 PW4000 set
 'hbf_x_idle':    ('md11','Sounds/FL2070-PW4000/External/Idle.wav','loop',0,4.5,32000,3),
 'hbf_x_whistle': ('md11','Sounds/FL2070-PW4000/External/Idle-Whistle.wav','loop',1,5,32000,3),
 'hbf_x_spool':   ('md11','Sounds/FL2070-PW4000/External/Spool.wav','loop',1,6,32000,3),
 'hbf_x_roar':    ('md11','Sounds/FL2070-PW4000/External/Roar.wav','loop',0.5,6,32000,3),
 'hbf_x_rear':    ('md11','Sounds/FL2070-PW4000/External/Idle-Rear.wav','loop',0.5,5,32000,2),
 'hbf_i_idle':    ('md11','Sounds/FL2070-PW4000/Cockpit/Idle.wav','loop',1,6,32000,2),
 'hbf_i_spool':   ('md11','Sounds/FL2070-PW4000/Cockpit/Spool.wav','loop',0.3,4.5,32000,2),
 'hbf_i_growl':   ('md11','Sounds/FL2070-PW4000/Cockpit/Growl.wav','loop',0.2,2.4,32000,2),
 # --- Trent (very large quad)
 'trent_1':       ('747','Sounds/jet-trent1.wav','loop',0,2.5,32000,3),
 'trent_2':       ('747','Sounds/jet-trent2.wav','loop',0,2.9,32000,3),
 # --- CFM56-class narrow-body (FL2070 A320 set)
 'cfm_x1':        ('a320','Sounds/FL2070/xabn11.wav','loop',1,6,32000,3),
 'cfm_x2':        ('a320','Sounds/FL2070/xabn12.wav','loop',0.5,5,32000,3),
 'cfm_x3':        ('a320','Sounds/FL2070/xabn13.wav','loop',1,6,32000,3),
 'cfm_x4':        ('a320','Sounds/FL2070/xabn14.wav','loop',1,6,32000,3),
 'cfm_i1':        ('a320','Sounds/FL2070/cfm11a.wav','loop',1,5,22050,2),
 'cfm_i3':        ('a320','Sounds/FL2070/cfm13a.wav','loop',1,5,22050,2),
 'cfm_i4':        ('a320','Sounds/FL2070/cfm14a.wav','loop',1,5,22050,2),
 'cfm_start':     ('a320','Sounds/FL2070/abn1strt.wav','once',0,None,22050,2),
 # --- low-bypass JT8D-class (tri-jet / SST)
 'jt8_idle':      ('727','Sounds/eng/idling.wav','loop',2,6,32000,3),
 'jt8_jet':       ('727','Sounds/eng/jet4.wav','loop',0.5,5,32000,3),
 'jt8_roar':      ('727','Sounds/eng/roar.wav','loop',0.5,5,32000,3),
 'jt8_set':       ('727','Sounds/eng/set4.wav','loop',1,6,32000,3),
 'jt8_whine':     ('727','Sounds/eng/whine.wav','loop',0.3,4,32000,3),
 'jt8_drone':     ('727','Sounds/eng/drone.wav','loop',0.2,3.2,22050,2),
 # --- CF34-class regional / large bizjet
 'cf34_whine':    ('crj','Sounds/whine.wav','loop',0.3,5,32000,3),
 'cf34_inside':   ('crj','Sounds/whine-inside.wav','loop',4,7,32000,2),
 'crj_reverse':   ('crj','Sounds/reverse-thrust.wav','loop',1,6,22050,2),
 'apu_run':       ('crj','Sounds/apu_run.wav','loop',5,6,22050,2),
 # --- small turbofan (bizjets)
 'bj_turbine':    ('citx','Sounds/eng/jet-turbine.wav','loop',0.2,4,32000,3),
 'bj_whine':      ('citx','Sounds/eng/jet-whine.wav','loop',0.3,6,32000,3),
 'bj_drone':      ('citx','Sounds/eng/xjet-drone.wav','loop',2,6,32000,2),
 'bj_thrust':     ('citx','Sounds/eng/xjet-thrust.wav','loop',0.2,3.8,32000,3),
 'bj_hiwhine':    ('citx','Sounds/eng/xjet-whine.wav','loop',0.1,2.4,32000,3),
 'bj_ext':        ('citx','Sounds/eng-ext.wav','loop',0.2,3.2,22050,3),
 'bj_int':        ('citx','Sounds/eng-int.wav','loop',1,6,22050,2),
 'turbojet_fan':  ('fgdata','Sounds/turbojet_fan.wav','loop',0.1,2.6,32000,3),
 'jet_start_out': ('alpha','Sounds/start-out.wav','once',0,None,22050,2),
 # --- turboprop
 'tprop_1':       ('fgdata','Sounds/turboprop1.wav','loop',0.2,3.6,22050,3),
 'tprop_drone':   ('fgdata','Sounds/engine-prop.wav','loop',2,7,32000,2),
 'prop_drone':    ('fgdata','Sounds/prop.wav','loop',3,7,32000,2),
 'tprop_start':   ('pc12','Sounds/starter.wav','once',0,None,22050,2),
 # --- piston
 'pist_run':      ('c172p','Sounds/engine.wav','loop',1,6,32000,3),
 'pist_idle':     ('c172p','Sounds/engine-idle.wav','loop',2,6,32000,3),
 'pist_start':    ('c172p','Sounds/engine-start.wav','once',0,None,32000,3),
 'pist_crank':    ('c172p','Sounds/engine-crank.wav','once',0,None,32000,3),
 'pist_cut':      ('c172p','Sounds/engine-cut.wav','once',0,None,32000,2),
 'radial':        ('fgdata','Sounds/wasp.wav','loop',0.05,1.55,22050,3),
 # --- helicopter turbine & rotor
 'hturb_out':     ('ec135','Sounds/turbine_idle_out_L.wav','loop',0.5,6,32000,3),
 'hturb_in':      ('ec135','Sounds/turbine_idle_in_L.wav','loop',0.5,5.5,32000,2),
 'hrotor_out':    ('ec135','Sounds/ec_rotor_out.wav','loop',0.2,5.4,32000,3),
 'hrotor_outb':   ('ec135','Sounds/ec_rotor_out_bass.wav','loop',0.2,5.4,32000,2),
 'hrotor_in':     ('ec135','Sounds/ec_rotor_in.wav','loop',0.2,5,32000,2),
 'hrotor_inb':    ('ec135','Sounds/ec_rotor_in_bass.wav','loop',0.2,5,32000,2),
 'blade_vortex':  ('ec135','Sounds/BladeVortex.wav','loop',0.1,2.0,32000,3),
 'h145_rotor':    ('ec145','Sounds/main_rotor_idle_power_v2.wav','loop',0.2,5,32000,3),
 'h145_rotor_in': ('ec145','Sounds/main_rotor_idle_power_inside_L.wav','loop',0.2,4.8,32000,2),
 'h_stall':       ('ec145','Sounds/main_rotor_idle_power_blade_stall.wav','loop',0.2,4,22050,2),
 'h_starter':     ('ec145','Sounds/starter_loop.wav','loop',0.1,2.4,22050,2),
 'lowrpm_horn':   ('ec145','Sounds/warn650.wav','once',0,None,22050,2),
 'uh1_flap':      ('uh1','Sounds/outside_only_flap.wav','loop',0.2,4.4,22050,3),
 'uh1_inside':    ('uh1','Sounds/inside_flap.wav','loop',1,7,22050,2),
 'uh1_turbine':   ('fgdata','Sounds/turbine_loop.wav','loop',0.1,1.7,22050,3),
 'tail_rotor':    ('uh1','Sounds/tailrotor.wav','loop',0.1,2.4,22050,2),
 'rotor_2blade':  ('fgdata','Sounds/rotor-2blade.wav','loop',0.05,0.95,32000,3),
 # --- airframe / environment
 'wind_in':       ('citx','Sounds/misc/cockpit-wind.wav','loop',2,7,22050,2),
 'wind_out':      ('fgdata','Sounds/wind1.wav','loop',0.5,7,32000,2),
 'wind_hi':       ('md11','Sounds/Devyn-Common/MD11-wind.wav','loop',0.5,5,32000,2),
 'rumble':        ('737','Sounds/rumble.wav','loop',4,7,22050,2),
 'tires_roll':    ('c172p','Sounds/tires-rolling-asphalt.wav','loop',0.5,6,22050,2),
 'touchdown':     ('727','Sounds/touch.wav','once',0,1.6,22050,3),
 'squeal':        ('fgdata','Sounds/squeal2.wav','once',0,None,22050,3),
 'gear_motor':    ('737','Sounds/gear.wav','once',0,9,22050,2),
 'gear_down':     ('citx','Sounds/gear-down.wav','once',0,None,32000,2),
 'gear_up':       ('citx','Sounds/gear-up.wav','once',0,None,32000,2),
 'flaps_motor':   ('c172p','Sounds/flaps-motor.wav','loop',0.6,4.6,22050,2),
 'flaps_hyd':     ('citx','Sounds/misc/citx-flaps.wav','loop',1,4,22050,2),
 'flaps_click':   ('c172p','Sounds/flaps-click.wav','once',0,None,32000,2),
 'reverser':      ('737','Sounds/reverser.wav','loop',2,6,22050,2),
 'rain':          ('fgdata','Sounds/rain.wav','loop',0.3,6,22050,2),
 'rain_shield':   ('fgdata','Sounds/rain-windshield.wav','loop',0.2,4.4,22050,2),
 'thunder1':      ('fgdata','Sounds/thunder1.wav','once',0,None,22050,2),
 'thunder2':      ('fgdata','Sounds/thunder2.wav','once',0,None,22050,2),
 'crash':         ('fgdata','Sounds/crash.wav','once',0,None,22050,2),
 'damage':        ('c172p','Sounds/damage-heavy.wav','once',0,None,22050,2),
 # --- cockpit alerts & UI
 'stall_horn':    ('737','Sounds/stall.wav','loop',0.05,1.2,22050,3),
 'ap_disc':       ('737','Sounds/Apdisco.wav','once',0,None,22050,3),
 'alt_alert':     ('737','Sounds/altAlert.wav','once',0,None,22050,3),
 'chime':         ('a320','Sounds/cabinalert.wav','once',0,None,22050,3),
 'gear_horn':     ('citx','Sounds/gear-hrn.wav','loop',0.5,2,22050,2),
 'click':         ('c172p','Sounds/double-click.wav','once',0,None,22050,3),
 'lever':         ('c172p','Sounds/lever.wav','once',0,None,22050,2),
 'gyro':          ('c172p','Sounds/gyro.wav','loop',0.1,1.8,22050,2),
 'avionics':      ('fgdata','Sounds/avionics-400Hz.wav','loop',0.5,2,22050,2),
}
for n in ['100-above','500-above','altitude-10','altitude-20','altitude-30','altitude-40','altitude-50','altitude-100',
          'altitude-200','altitude-300','altitude-400','altitude-500','altitude-1000','altitude-2500','minimums','retard',
          'sink-rate','pull-up','too-low-gear','too-low-flaps','bank-angle','terrain','dont-sink','glideslope']:
    C['gpws_'+n.replace('-','_')] = ('fgdata','Sounds/mk-viii/%s.wav'%n,'once',0,None,22050,3)

def load(path, start, length, sr_out):
    x, sr = sf.read(path, always_2d=True, dtype='float64')
    x = x.mean(axis=1)
    if x.dtype != np.float64: x = x.astype(np.float64)
    a = int(start*sr)
    x = x[a:]
    return x, sr

def make_loop(x, sr, length):
    X = int(min(0.35*sr, length*sr*0.12))           # crossfade length
    L = int(length*sr)
    need = L + X
    if len(x) < need:
        L = len(x) - X
    seg = x[:L+X].copy()
    t = np.linspace(0, np.pi/2, X)
    fin, fout = np.sin(t), np.cos(t)
    out = seg[:L].copy()
    out[:X] = seg[:X]*fin + seg[L:L+X]*fout
    return out

def to_sr(x, sr, sr_out):
    if sr_out >= sr: return x, sr
    g = gcd(int(sr), int(sr_out))
    return resample_poly(x, sr_out//g, sr//g), sr_out

def main():
    pack = {}; meta = {}
    total = 0
    for cid,(repo,path,kind,start,length,sr_out,q) in C.items():
        full = os.path.join(SRC, P[repo], path)
        x, sr = load(full, start, length, sr_out)
        x = x - np.mean(x)
        x, sr = to_sr(x, sr, sr_out)
        if kind == 'loop':
            x = make_loop(x, sr, length)
            rms = np.sqrt(np.mean(x**2)) + 1e-9
            x = x * (0.18/rms)                        # equal loudness for loop layers
        else:
            if length: x = x[:int(length*sr)]
            fade = int(0.01*sr)
            if length and len(x) > 2*fade: x[-fade:] *= np.linspace(1,0,fade)
            x = x * (0.89/ (np.max(np.abs(x))+1e-9))
        x = np.clip(x, -0.99, 0.99)
        with tempfile.TemporaryDirectory() as td:
            wav = os.path.join(td,'a.wav'); ogg = os.path.join(td,'a.ogg')
            sf.write(wav, x.astype(np.float32), int(sr), subtype='PCM_16')
            subprocess.run([FF,'-y','-loglevel','error','-i',wav,'-c:a','libvorbis','-q:a',str(q),ogg], check=True)
            data = open(ogg,'rb').read()
        total += len(data)
        pack[cid] = base64.b64encode(data).decode()
        meta[cid] = {'loop': kind=='loop', 'dur': round(len(x)/sr,3)}
        print(f"{cid:18s} {kind:4s} {len(x)/sr:5.2f}s {sr}Hz {len(data)//1024}KB")
    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    with open(OUT_JS,'w') as f:
        f.write('/* Generated by tools/build_audio.py - recordings from FlightGear projects (GPL-2.0), see ATTRIBUTION.md */\n')
        f.write('window.FS_AUDIO_META=' + json.dumps(meta, separators=(',',':')) + ';\n')
        f.write('window.FS_AUDIO_PACK={\n')
        for k,v in pack.items():
            f.write(f'"{k}":"{v}",\n')
        f.write('};\n')
    # attribution table
    rows = {}
    for cid,(repo,path,*_) in C.items():
        rows.setdefault(repo, []).append((cid, path))
    with open(os.path.join(os.path.dirname(__file__), 'audio_sources.json'),'w') as f:
        json.dump({r:{'url':R[r],'files':rows[r]} for r in rows}, f, indent=1)
    print('TOTAL', total//1024, 'KB ogg,', len(C), 'clips')

main()
