"""
End-to-end browser test (Chromium via Playwright).
- Real front-end + real API handlers + in-memory mock database (tests/e2e-server.js)
- face-api.js is replaced by a deterministic stub (no internet needed), so this proves the
  app flow and UI, not the real model accuracy.
Run:  python3 tests/e2e.py
"""
import subprocess, time, sys, os, re, json, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 4173
BASE = f"http://127.0.0.1:{PORT}"
SHOTS = os.environ.get("SHOTS", "/home/claude/shots")
os.makedirs(SHOTS, exist_ok=True)

STUB = r"""
(function(){
  function descriptor(seed, noise){
    var d=[], x=seed*9301+49297;
    for(var i=0;i<128;i++){ x=(x*9301+49297)%233280; d.push(x/233280-0.5); }
    var n=Math.sqrt(d.reduce(function(s,v){return s+v*v;},0));
    return d.map(function(v,i){ return (v/n)*0.9 + (noise? Math.sin(i*12.9898+seed+noise)*noise:0); });
  }
  function mk(seeds, w){
    return seeds.map(function(sd,i){ return {
      detection:{ box:{ x:20+i*130, y:40, width:110, height:120 }, score:0.93 },
      descriptor:new Float32Array(descriptor(sd.seed, sd.noise||0)) }; });
  }
  var net={ loadFromUri:function(){ return Promise.resolve(); } };
  window.faceapi={
    tf:{ ready:function(){ return Promise.resolve(); } },
    nets:{ tinyFaceDetector:net, ssdMobilenetv1:net, faceLandmark68Net:net, faceRecognitionNet:net },
    TinyFaceDetectorOptions:function(){}, SsdMobilenetv1Options:function(){},
    detectAllFaces:function(input, opts){
      var group = opts instanceof window.faceapi.SsdMobilenetv1Options;
      var chain={ withFaceLandmarks:function(){ return chain; },
        withFaceDescriptors:function(){
          var seeds = group ? (window.__groupQueue && window.__groupQueue.length ? window.__groupQueue.shift() : (window.__group||[])) : (window.__live||[]);
          return Promise.resolve(mk(seeds)); } };
      return chain;
    }
  };
})();
"""

FAKE_SPEECH = r"""
window.webkitSpeechRecognition = function(){
  var self=this; this.start=function(){ setTimeout(function(){
      var r=[{transcript:(window.__speech||'I am present my name is Bhavna')}]; r.isFinal=true;
      if(self.onresult) self.onresult({resultIndex:0, results:[r]}); }, 250); };
  this.stop=function(){ if(self.onend) self.onend(); };
};
window.SpeechRecognition = window.webkitSpeechRecognition;
"""

problems = []
def check(cond, msg):
    if not cond:
        problems.append(msg); print("  FAIL:", msg)
    else:
        print("  ok  ", msg)

def mk_page(browser, init=""):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, permissions=["camera", "microphone"], accept_downloads=True)
    ctx.add_init_script("window.__live=[]; window.__group=[];" + init)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" and "Failed to load resource" not in m.text and "ERR_" not in m.text else None)
    def route(r):
        u = r.request.url
        if u.startswith(BASE): return r.continue_()
        if u.endswith("/dist/face-api.js"): return r.fulfill(body=STUB, content_type="text/javascript")
        return r.abort()
    page.route("**/*", route)
    return ctx, page, errors

def make_photo(path, w=800, h=600):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (w, h), (200, 210, 240)); d = ImageDraw.Draw(im)
    for i in range(3): d.ellipse((60+i*200, 150, 200+i*200, 330), fill=(230, 180, 150))
    im.save(path)

def main():
    server = subprocess.Popen(["node", "tests/e2e-server.js"], cwd=ROOT, env={**os.environ, "PORT": str(PORT)}, stdout=subprocess.PIPE, text=True)
    try:
        assert "READY" in server.stdout.readline()
        photo = "/tmp/class1.png"; make_photo(photo)
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
            allerrors = []

            # ------------------------------------------------ home
            print("HOME")
            ctxS, S, errS = mk_page(browser, FAKE_SPEECH); allerrors += [errS]
            S.goto(BASE + "/"); S.wait_for_selector(".role-card.role-student")
            check(S.locator(".role-card").count() == 2, "home shows two role cards")
            S.screenshot(path=f"{SHOTS}/01-home.png")

            # ------------------------------------------------ teacher register + login + subject
            print("TEACHER AUTH + SUBJECT")
            ctxT, T, errT = mk_page(browser, FAKE_SPEECH); allerrors += [errT]
            T.goto(BASE + "/#/teacher"); T.wait_for_selector("text=Login using password")
            T.get_by_role("button", name="Register instead").click()
            T.fill("#ruser", "ananya"); T.fill("#rname", "Ananya Roy"); T.fill("#rpass", "secret123"); T.fill("#rpass2", "different")
            T.get_by_role("button", name="Register", exact=True).click()
            T.wait_for_selector("text=passwords do not match")
            T.fill("#rpass2", "secret123"); T.get_by_role("button", name="Register", exact=True).click()
            T.wait_for_selector("text=Login using password")
            check(T.input_value("#tuser") == "ananya", "username prefilled after register")
            T.fill("#tpass", "wrong"); T.get_by_role("button", name="Login", exact=True).click()
            T.wait_for_selector("text=Invalid username or password")
            T.fill("#tpass", "secret123"); T.get_by_role("button", name="Login", exact=True).click()
            T.wait_for_selector("text=Welcome, Ananya Roy")
            check(True, "teacher logged in")
            T.get_by_role("tab", name="Manage Subjects").click()
            T.get_by_role("button", name="Create new subject").first.click()
            T.fill("#sc-code", "cs101"); T.fill("#sc-name", "Intro to CS"); T.fill("#sc-sec", "A")
            T.get_by_role("button", name="Create subject").last.click()
            T.wait_for_selector(".subject-card h3:has-text('Intro to CS')")
            check(T.locator(".code-chip", has_text="CS101").count() == 1, "subject created with uppercase code")
            T.screenshot(path=f"{SHOTS}/02-teacher-subjects.png")

            # ------------------------------------------------ student A registers via face
            print("STUDENT REGISTER + ENROLL")
            ctxS.add_init_script("window.__live=[{seed:1}];")
            S.goto(BASE + "/?join=cs101#/student")
            S.wait_for_selector("text=Register new profile", timeout=20000)
            S.screenshot(path=f"{SHOTS}/03-student-register.png")
            S.fill("#sname", "Aarav Mehta")
            S.get_by_role("button", name="Create account").click()
            S.wait_for_selector("text=Welcome, Aarav Mehta", timeout=30000)
            check(True, "student A registered via face flow")
            S.wait_for_selector("text=Quick enrollment")
            check(S.locator("dialog.modal", has_text="Intro to CS").count() == 1, "join link opens quick-enroll for the subject")
            S.get_by_role("button", name="Yes, enroll me").click()
            S.wait_for_selector(".subject-card h3:has-text('Intro to CS')")
            check(True, "student A enrolled via link")

            # ------------------------------------------------ student B in a second context
            ctxS2, S2, errS2 = mk_page(browser); allerrors += [errS2]
            ctxS2.add_init_script("window.__live=[{seed:2}];")
            S2.goto(BASE + "/#/student"); S2.wait_for_selector("text=Register new profile", timeout=20000)
            S2.fill("#sname", "Bhavna Rao"); S2.get_by_role("button", name="Create account").click()
            S2.wait_for_selector("text=Welcome, Bhavna Rao", timeout=30000)
            S2.get_by_role("button", name="Enroll in subject").click()
            S2.fill("#ecode", "CS101"); S2.get_by_role("button", name="Enroll now").click()
            S2.wait_for_selector(".subject-card h3:has-text('Intro to CS')")
            check(True, "student B registered and enrolled by code")

            # duplicate face guard (new context, same face as A)
            ctxD, D, errD = mk_page(browser); allerrors += [errD]
            ctxD.add_init_script("window.__live=[{seed:1}];")
            D.goto(BASE + "/#/student")
            # same face as A logs straight in
            D.wait_for_selector("text=Welcome, Aarav Mehta", timeout=30000)
            check(True, "returning student A logs in by face")
            ctxD.close()

            # ------------------------------------------------ teacher takes attendance (upload photo)
            print("TAKE ATTENDANCE")
            T.get_by_role("tab", name="Take Attendance").click()
            T.wait_for_selector("text=Take AI attendance")
            T.get_by_role("button", name="Add photos").click()
            T.get_by_role("tab", name="Upload photos").click()
            T.set_input_files("#att-files", photo)
            T.wait_for_selector("text=Photos added: 1")
            T.get_by_role("button", name="Done").click()
            T.evaluate("window.__group=[{seed:1,noise:0.02},{seed:99}]")
            T.get_by_role("button", name="Run face analysis").click()
            T.wait_for_selector("dialog.modal:has-text('Attendance report')", timeout=20000)
            T.wait_for_timeout(400)
            T.screenshot(path=f"{SHOTS}/04-review.png")
            rowA = T.locator("dialog tbody tr", has_text="Aarav Mehta")
            rowB = T.locator("dialog tbody tr", has_text="Bhavna Rao")
            check(rowA.locator("button.p").get_attribute("aria-pressed") == "true", "Aarav detected present")
            check(rowB.locator("button.a").get_attribute("aria-pressed") == "true", "Bhavna absent (not in photo)")
            check(T.locator("dialog canvas.annot").count() == 1, "annotated photo is shown")
            rowB.locator("button.p").click()  # manual override
            T.get_by_role("button", name="Confirm and save").click()
            T.wait_for_selector("text=Attendance saved: 2 of 2 present")
            check(True, "attendance saved with manual override")

            # ------------------------------------------------ voice attendance
            print("VOICE")
            T.get_by_role("button", name="Use voice attendance").click()
            T.wait_for_selector("dialog:has-text('Voice attendance')")
            T.get_by_role("button", name="Start listening").click()
            T.wait_for_selector(".name-chip.heard:has-text('Bhavna Rao')", timeout=5000)
            check(T.locator(".name-chip.heard").count() == 1, "voice: only the spoken name is highlighted")
            T.get_by_role("button", name="Review attendance").click()
            T.wait_for_selector("dialog.modal:has-text('Voice attendance - review')")
            check(T.locator("dialog tbody tr", has_text="Bhavna Rao").locator("button.p").get_attribute("aria-pressed") == "true", "voice review marks Bhavna present")
            T.screenshot(path=f"{SHOTS}/05-voice-review.png")
            T.locator("dialog").get_by_role("button", name="Discard").click()

            # ------------------------------------------------ manual
            T.get_by_role("button", name="Mark manually").click()
            T.wait_for_selector("dialog.modal:has-text('Mark attendance')")
            check(T.locator("dialog .banner.warn").count() >= 0, "manual dialog opens")
            T.wait_for_selector("dialog .banner.warn:has-text('already saved 1 time')", timeout=5000)
            check(True, "same-day duplicate warning shown")
            T.locator("dialog").get_by_role("button", name="Discard").click()

            # ------------------------------------------------ records
            print("RECORDS")
            T.get_by_role("tab", name="Attendance Records").click()
            T.wait_for_selector("text=/Class(es)? held/")
            T.select_option("#rec-subject", index=1)
            T.wait_for_selector("text=Students (lowest attendance first)")
            check(T.locator("td", has_text="2/2").count() >= 1, "records list shows the class 2/2")
            with T.expect_download() as dl:
                T.get_by_role("button", name="Export CSV").click()
            path = dl.value.path()
            csv_text = open(path, encoding="utf-8-sig").read()
            check("Aarav Mehta" in csv_text and "Bhavna Rao" in csv_text and "Attendance %" in csv_text, "CSV export contains the roster")
            T.get_by_role("button", name="View / edit").first.click()
            T.wait_for_selector("dialog.modal .t tbody tr")
            T.locator("dialog tbody tr", has_text="Bhavna Rao").locator("button.a").click()
            T.get_by_role("button", name="Save changes").click()
            T.wait_for_selector("text=Attendance updated")
            T.wait_for_selector("td:has-text('1/2')")
            check(True, "session edit works (class now 1/2)")
            T.screenshot(path=f"{SHOTS}/06-records.png")

            # ------------------------------------------------ share dialog
            T.get_by_role("tab", name="Manage Subjects").click()
            T.get_by_role("button", name="Share code").click()
            T.wait_for_selector("dialog:has-text('/?join=CS101')")
            check(True, "share dialog shows join link")
            T.screenshot(path=f"{SHOTS}/07-share.png")
            T.keyboard.press("Escape")
            T.get_by_role("button", name="Students").click()
            T.wait_for_selector("dialog:has-text('Aarav Mehta')")
            T.screenshot(path=f"{SHOTS}/08-roster.png")
            T.keyboard.press("Escape")

            # ------------------------------------------------ student dashboard shows stats
            print("STUDENT DASHBOARD")
            S2.reload(); S2.wait_for_selector(".subject-card")
            check(S2.locator(".subject-card .ring .val").first.inner_text().strip() == "0%", "student B sees 0% after being marked absent (0/1)")
            S.reload(); S.wait_for_selector(".subject-card"); S.wait_for_timeout(300)
            check(S.locator(".subject-card .ring .val").first.inner_text().strip() == "100%", "student A sees 100%")
            check("miss" in S.locator(".tip").first.inner_text() or "right at" in S.locator(".tip").first.inner_text(), "smart tip is shown")
            S.screenshot(path=f"{SHOTS}/09-student-dashboard.png", full_page=True)

            # theme toggle
            S.locator(".theme-btn").first.click()
            check(S.evaluate("document.documentElement.getAttribute('data-theme')") == "dark", "dark mode toggles")
            S.screenshot(path=f"{SHOTS}/10-student-dark.png", full_page=True)

            # ------------------------------------------------ mobile views
            print("MOBILE")
            ctxM = browser.new_context(viewport={"width": 390, "height": 800}, device_scale_factor=2)
            M = ctxM.new_page(); M.route("**/*", lambda r: r.continue_() if r.request.url.startswith(BASE) else r.abort())
            M.goto(BASE + "/"); M.wait_for_selector(".role-card"); M.screenshot(path=f"{SHOTS}/11-mobile-home.png")
            check(M.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "mobile home has no horizontal scroll")
            ctxM.close()

            # ------------------------------------------------ logout + auth guard
            T.locator("button:has-text('Logout')").click()
            T.wait_for_selector(".role-card")
            check(True, "teacher logout returns home")

            for e in allerrors:
                for line in e: print("  JS-ERROR:", line); problems.append(line)
            browser.close()
    finally:
        server.terminate()
    print("\nRESULT:", "ALL E2E CHECKS PASSED" if not problems else f"{len(problems)} PROBLEM(S)")
    sys.exit(1 if problems else 0)

if __name__ == "__main__":
    main()
