"""End-to-end test of the real LumiLooks desktop app (Linux build) through tauri-driver + WebKitWebDriver.

Usage: xvfb + tauri-driver must be available.  python3 e2e/tauri_e2e.py <app-binary> <photo> <video> <out-dir>
"""
import json, os, subprocess, sys, time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.options import ArgOptions

APP, PHOTO, VIDEO, OUT = sys.argv[1:5]
os.makedirs(OUT, exist_ok=True)
results = []

def check(name, condition, detail=''):
    results.append((name, bool(condition), detail))
    print(('PASS ' if condition else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

def wait(fn, timeout=30, step=0.25):
    end = time.time() + timeout
    while time.time() < end:
        try:
            value = fn()
            if value:
                return value
        except Exception:
            pass
        time.sleep(step)
    return None

opts = ArgOptions()
opts.set_capability('browserName', 'wry')
opts.set_capability('tauri:options', {'application': APP})
driver = webdriver.Remote('http://127.0.0.1:4444', options=opts)
js = driver.execute_script
def ajs(script, *args):
    return driver.execute_async_script('const done = arguments[arguments.length - 1];' + script, *args)
def exists(selector):
    return len(driver.find_elements(By.CSS_SELECTOR, selector)) > 0
def shot(name):
    driver.save_screenshot(os.path.join(OUT, name + '.png'))

try:
    driver.set_window_size(1512, 980)
    wait(lambda: exists('#empty-import'), 40)
    time.sleep(1)
    shot('01-empty')
    check('Ouverture sans image de démonstration', exists('#empty-import') and not exists('.media-item'))
    check('Panneaux masqués sans média', not any(exists(s) for s in ['.looks-panel', '.controls-panel', '.media-strip', '.viewer-toolbar', '#compare', '.chain-panel']))
    logo = js("const i=document.querySelector('.empty-logo img');return i?[i.getBoundingClientRect().width,i.draggable,i.getAttribute('src')]:null")
    check('Logo LumiLooks agrandi et non déplaçable', logo and logo[0] >= 140 and logo[1] is False and 'lumilooks-logo' in logo[2], str(logo))
    blocked = js("const img=document.querySelector('.empty-logo img');const e=new DragEvent('dragstart',{bubbles:true,cancelable:true});img.dispatchEvent(e);return e.defaultPrevented")
    check('Glisser-déposer des images internes bloqué', blocked is True)
    icons = js("return [...document.querySelectorAll('svg[data-icon]')].map(s=>s.dataset.icon)")
    check('Icônes SVG solid (MingCute fill)', icons and all(i.startswith('mingcute:') and i.endswith('-fill') for i in icons), f'{len(icons)} icônes')

    # ---- Photo
    r = ajs("window.__lumilooks.importPaths([arguments[0]]).then(()=>done('ok'),e=>done('ERR '+e))", PHOTO)
    wait(lambda: js("return document.querySelectorAll('.preset-card img').length") > 20, 40)
    time.sleep(1.5)
    shot('02-photo')
    check('Import photo', exists('.media-item') and exists('.looks-panel') and exists('.controls-panel'), r)
    px = js("""const c=document.querySelector('#preview');const t=document.createElement('canvas');t.width=64;t.height=48;const x=t.getContext('2d');x.drawImage(c,0,0,64,48);const d=x.getImageData(0,0,64,48).data;let s=0;for(let i=0;i<d.length;i+=4)s+=d[i]+d[i+1]+d[i+2];return [c.width,c.height,s]""")
    check('Aperçu WebGL rendu (protocole media, sans canvas « tainted »)', px and px[2] > 10000, str(px))
    def sample():
        return js("""const c=document.querySelector('#preview');const t=document.createElement('canvas');t.width=48;t.height=32;const x=t.getContext('2d');x.drawImage(c,0,0,48,32);return Array.from(x.getImageData(0,0,48,32).data)""")
    before = sample()
    driver.find_element(By.CSS_SELECTOR, '[data-preset="noir"]').click()
    time.sleep(0.8)
    after = sample()
    sat = max(abs(after[i] - after[i + 1]) + abs(after[i + 1] - after[i + 2]) for i in range(0, len(after), 4))
    check('Look appliqué (Noir absolu = noir et blanc)', sat < 30 and before != after, f'écart couleur max {sat}')

    for key, values in [('hazeAmount', {'hazeAmount': 70}), ('flareAmount', {'flareAmount': 90, 'flareThreshold': 30}), ('aberration', {'aberration': 100}), ('distortion', {'distortion': 80}), ('diffusionAmount', {'diffusionAmount': 90, 'diffusionThreshold': 20})]:
        js("window.__lumilooks.applyPreset('original')")
        time.sleep(0.3)
        base = sample()
        js("window.__lumilooks.setSettings(arguments[0])", values)
        time.sleep(0.6)
        changed = sample()
        diff = sum(abs(a - b) for a, b in zip(base, changed)) / len(base)
        check(f'Effet {key} visible', diff > 0.8, f'différence moyenne {diff:.2f}')
    js("window.__lumilooks.setSettings({hazeAmount:45,flareAmount:60,flareThreshold:40,aberration:40,distortion:30,diffusionAmount:50})")
    driver.find_element(By.CSS_SELECTOR, '[data-tab="optics"]').click()
    time.sleep(0.8)
    shot('03-optics')
    check('Onglet Effets avec 5 sections', len(driver.find_elements(By.CSS_SELECTOR, '.optics-section')) == 5)

    # Panels collapse independently
    driver.find_element(By.CSS_SELECTOR, '#collapse-left').click(); time.sleep(0.3)
    left_only = exists('.looks-panel.collapsed') and not exists('.controls-panel.collapsed')
    driver.find_element(By.CSS_SELECTOR, '#collapse-right').click(); time.sleep(0.3)
    both = exists('.looks-panel.collapsed') and exists('.controls-panel.collapsed')
    shot('04-collapsed')
    driver.find_element(By.CSS_SELECTOR, '#expand-left').click(); time.sleep(0.3)
    right_only = not exists('.looks-panel.collapsed') and exists('.controls-panel.collapsed')
    driver.find_element(By.CSS_SELECTOR, '#expand-right').click(); time.sleep(0.3)
    check('Barres gauche et droite réductibles indépendamment', left_only and both and right_only)

    # Fullscreen
    driver.find_element(By.CSS_SELECTOR, '#fullscreen').click()
    time.sleep(1.2)
    fs = js("return [document.querySelector('.app').classList.contains('is-fullscreen'), !!document.querySelector('.app-header'), !!document.querySelector('.looks-panel'), window.innerWidth, window.innerHeight, screen.width, screen.height]")
    shot('05-fullscreen')
    check('Plein écran exclusif (seul le média)', fs[0] and not fs[1] and not fs[2], str(fs))
    js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
    time.sleep(0.8)
    check('Sortie du plein écran (Échap)', exists('.app-header') and not js("return document.querySelector('.app').classList.contains('is-fullscreen')"))

    # Color correction round-trip through the real file commands
    cube = os.path.join(OUT, 'correction.cube')
    js("window.__lumilooksNextSavePath=arguments[0]", cube)
    driver.find_element(By.CSS_SELECTOR, '#export-cube').click()
    wait(lambda: os.path.exists(cube), 15)
    exported = js("return JSON.stringify(window.__lumilooks.getState().files[0].settings)")
    js("window.__lumilooks.applyPreset('original')")
    time.sleep(0.4)
    js("window.__lumilooksNextOpenPath=arguments[0]", cube)
    driver.find_element(By.CSS_SELECTOR, '#import-correction').click()
    wait(lambda: js("return JSON.stringify(window.__lumilooks.getState().files[0].settings)") == exported, 15)
    restored = js("return JSON.stringify(window.__lumilooks.getState().files[0].settings)")
    head = open(cube, encoding='utf-8').read(400) if os.path.exists(cube) else ''
    check('Correction .cube : export puis réimport restaure tous les réglages', restored == exported and 'LUT_3D_SIZE' in open(cube).read() and 'LUMILOOKS-GRADE-BEGIN' in head)

    # Image export with manual size and linked ratio
    driver.find_element(By.CSS_SELECTOR, '[data-tab="light"]').click()
    js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',ctrlKey:true,bubbles:true}))")
    wait(lambda: exists('#export-width'), 10)
    w = driver.find_element(By.CSS_SELECTOR, '#export-width input')
    w.send_keys(Keys.CONTROL, 'a'); w.send_keys('900'); w.send_keys(Keys.ENTER)
    time.sleep(0.4)
    h_linked = driver.find_element(By.CSS_SELECTOR, '#export-height input').get_attribute('value')
    shot('06-export-image')
    check('Largeur/hauteur liées (ratio conservé)', h_linked == '600', h_linked)
    driver.find_element(By.CSS_SELECTOR, '#export-link').click()
    hh = driver.find_element(By.CSS_SELECTOR, '#export-height input')
    hh.send_keys(Keys.CONTROL, 'a'); hh.send_keys('500'); hh.send_keys(Keys.ENTER)
    time.sleep(0.3)
    unlinked_w = driver.find_element(By.CSS_SELECTOR, '#export-width input').get_attribute('value')
    check('Largeur/hauteur déliées', unlinked_w == '900', unlinked_w)
    png = os.path.join(OUT, 'export.png')
    js("window.__lumilooksNextSavePath=arguments[0]", png)
    driver.find_element(By.CSS_SELECTOR, '#export-confirm').click()
    wait(lambda: exists('#export-success'), 30)
    dims = subprocess.run(['python3', '-c', f"from PIL import Image;print(Image.open('{png}').size)"], capture_output=True, text=True).stdout.strip() if os.path.exists(png) else 'absent'
    check('Export PNG à la taille choisie', dims == '(900, 500)', dims)
    driver.find_element(By.CSS_SELECTOR, '#export-close').click()
    # PDF
    js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',ctrlKey:true,bubbles:true}))")
    wait(lambda: exists('#export-format'), 10)
    driver.find_element(By.CSS_SELECTOR, '#export-format button').click(); time.sleep(0.3)
    [o for o in driver.find_elements(By.CSS_SELECTOR, '.ll-option') if o.text.startswith('PDF')][0].click()
    pdf = os.path.join(OUT, 'export.pdf')
    js("window.__lumilooksNextSavePath=arguments[0]", pdf)
    driver.find_element(By.CSS_SELECTOR, '#export-confirm').click()
    wait(lambda: exists('#export-success'), 30)
    check('Export PDF', os.path.exists(pdf) and open(pdf, 'rb').read(5) == b'%PDF-')
    driver.find_element(By.CSS_SELECTOR, '#export-close').click()

    # ---- Video
    r = ajs("window.__lumilooks.importPaths([arguments[0]]).then(()=>done('ok'),e=>done('ERR '+e))", VIDEO)
    wait(lambda: js("const f=window.__lumilooks.getState();return f.files.length===2&&f.files[1].duration>0"), 40)
    time.sleep(2)
    shot('07-video')
    info = js("const s=window.__lumilooks.getState();const f=s.files[1];return [f.width,f.height,f.duration,s.activeId===f.id]")
    check('Import vidéo (lecture via protocole media)', info and info[0] == 1280 and info[3], f'{r} {info}')
    vpx = js("""const c=document.querySelector('#preview');const t=document.createElement('canvas');t.width=32;t.height=18;const x=t.getContext('2d');x.drawImage(c,0,0,32,18);const d=x.getImageData(0,0,32,18).data;let s=0;for(let i=0;i<d.length;i+=4)s+=d[i]+d[i+1]+d[i+2];return s""")
    check('Image vidéo rendue en WebGL', vpx and vpx > 1000, str(vpx))
    driver.find_element(By.CSS_SELECTOR, '#edit-tab').click(); time.sleep(0.5)
    edit_ok = exists('#timeline')
    driver.find_element(By.CSS_SELECTOR, '#grade-tab').click(); time.sleep(0.5)
    grade_ok = not exists('#timeline') and exists('.controls-panel') and driver.find_element(By.CSS_SELECTOR, '#grade-tab').is_displayed()
    check('Retour à « Étalonnage » possible avec une vidéo', edit_ok and grade_ok)
    js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',ctrlKey:true,bubbles:true}))")
    wait(lambda: exists('#export-bitrate'), 10)
    wait(lambda: 'détection' not in driver.find_element(By.CSS_SELECTOR, '#export-encoder button').text, 20)
    time.sleep(0.5)
    shot('08-export-video')
    est = driver.find_element(By.CSS_SELECTOR, '#export-estimate strong').text
    has_engine_line = js("return !!document.querySelector('#export-engine')")
    br = driver.find_element(By.CSS_SELECTOR, '#export-bitrate input')
    br.send_keys(Keys.CONTROL, 'a'); br.send_keys('3000'); br.send_keys(Keys.ENTER)
    time.sleep(0.3)
    est2 = driver.find_element(By.CSS_SELECTOR, '#export-estimate strong').text
    check('Débit kbit/s + taille estimée qui suit le débit', est != est2 and 'Mo' in est2, f'{est} → {est2}')
    driver.find_element(By.CSS_SELECTOR, '#export-encoder button').click(); time.sleep(0.3)
    opts_text = [o.text for o in driver.find_elements(By.CSS_SELECTOR, '.ll-option')]
    driver.find_element(By.CSS_SELECTOR, '.ll-option').click()
    check('Choix CPU / GPU sans la ligne « Encodage : GPU NVIDIA · NVENC »', not has_engine_line and any('CPU' in t for t in opts_text) and any('GPU' in t for t in opts_text), ' | '.join(opts_text))
    mp4 = os.path.join(OUT, 'export.mp4')
    js("window.__lumilooksNextSavePath=arguments[0]", mp4)
    driver.find_element(By.CSS_SELECTOR, '#export-confirm').click()
    done = wait(lambda: exists('#export-success'), 240, 1)
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,bit_rate:format=duration,size', '-of', 'json', mp4], capture_output=True, text=True).stdout if os.path.exists(mp4) else '{}'
    data = json.loads(probe or '{}')
    streams = {s['codec_type']: s for s in data.get('streams', [])}
    size = int(data.get('format', {}).get('size', 0))
    check('Export vidéo MP4 (H.264 + audio, 3000 kbit/s)', done and streams.get('video', {}).get('codec_name') == 'h264' and 'audio' in streams and abs(float(data['format']['duration']) - 4) < 0.3,
          f"{streams.get('video', {}).get('width')}x{streams.get('video', {}).get('height')} {size} octets, débit vidéo {streams.get('video', {}).get('bit_rate')}")
    driver.find_element(By.CSS_SELECTOR, '#export-close').click()
finally:
    try:
        shot('99-final')
    except Exception:
        pass
    driver.quit()

failed = [r for r in results if not r[1]]
print(f'\n{len(results) - len(failed)}/{len(results)} vérifications réussies')
sys.exit(1 if failed else 0)
