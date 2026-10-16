# Attendo (vanilla JS + Vercel)

Aapka Streamlit wala Attendo, ab **normal HTML / CSS / JavaScript** mein, jo Vercel pe deploy hota hai.
Koi Python, Streamlit, dlib ya InsightFace nahi chahiye, to install ya build errors bhi nahi aate.

```
index.html, css/, js/      -> front-end (vanilla, no build step)
api/rpc.js, lib/           -> Vercel serverless API (Node)
supabase/schema.sql        -> database setup (ek baar run karna hai)
tests/                     -> offline API test + browser test
```

## Deploy (15 minute)

### 1) Supabase (database)
1. Apna purana Supabase project kholo (ya naya banao).
2. **SQL Editor -> New query**, `supabase/schema.sql` ka pura content paste karke **Run** karo.
   - Purana data (teachers, subjects, attendance) safe rehta hai. Ye sirf `students.face_descriptor` column add karta hai.
3. **Project Settings -> API** se ye do cheezein copy karo:
   - `Project URL`
   - `service_role` key (secret hai, kisi ko mat dikhana)

### 2) GitHub
Is folder ko ek GitHub repo mein push kar do (`.env` push mat karna, `.gitignore` already handle karta hai).

### 3) Vercel
1. vercel.com -> **Add New -> Project** -> apni repo import karo.
2. Framework Preset: **Other**. Build command aur output directory **khali** chhodo.
3. **Environment Variables** mein ye 3 add karo:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_KEY` | service_role key |
| `SESSION_SECRET` | koi bhi lamba random text |

4. **Deploy** dabao.

### 4) Check
Deploy hone ke baad ye link kholo: `https://YOUR-SITE.vercel.app/api/rpc?action=health`
Agar `"ok": true` dikhe to sab sahi hai. Agar `false` hai to `hint` mein likha hota hai ki kya karna hai.

> Camera aur microphone sirf **HTTPS** pe chalte hain. Vercel automatically HTTPS deta hai.

## Purane app se kya badla

| Feature | Pehle | Ab |
|---|---|---|
| Face recognition | InsightFace (Python server) | face-api.js, browser mein chalta hai |
| Voice attendance | Speaker voice match (Resemblyzer) | Browser speech recognition: bolay hue **naam** pehchanta hai |
| Teacher password | bcrypt | bcrypt (purane passwords chalte rahenge) |
| QR / join link | `attendo-main.streamlit.app` | Aapki Vercel site, `?join=CODE` |

**Zaroori baatein**
- Face model alag hai, isliye **purane students ko ek baar FaceID se dobara register** karna hoga. Unka naam, enrollments aur attendance history waise hi rahegi, sirf naya face profile banega.
- Voice attendance ab "kaun bola" nahi, "kya bola" pehchanta hai. Students bolte hain: *"I am present, my name is Aarav"*. Chrome, Edge ya Safari chahiye, aur internet.
- Face engine aur models pehli baar CDN (jsdelivr) se download hote hain, phir browser cache kar leta hai.

## Naye features
- Review screen: har student ko Present/Absent **haath se badal sakte ho** save karne se pehle
- Photos pe naam ke saath **boxes** (green = pehchana, red = nahi pehchana)
- Bade classroom photo ke liye **tiles mein scan** (peeche ke chhote chehre bhi milte hain)
- Ek se zyada photos, camera ya upload
- **Manual attendance** aur **voice attendance**, ek hi review screen mein
- Purani date/time ke liye attendance save karna, aur duplicate-same-day warning
- Records: trend chart, student-wise %, **at-risk (<75%)**, session edit/delete, **CSV export**, print
- Student dashboard: % ring, **"kitni classes miss kar sakte ho"** wala tip, apna target slider
- Student apne **face samples badha** sakta hai (accuracy ke liye)
- Teacher: students list, student hatana, subject delete, WhatsApp / QR share
- Dark mode, mobile-friendly, home screen pe install (PWA manifest)
- Face data server pe hi match hota hai, browser ko kabhi nahi bhejta

## Local pe chalana / test
```
npm i -g vercel
vercel dev          # site + API ek saath (.env mein 3 variables rakhna)
node tests/api.test.js   # API test (offline)
python3 tests/e2e.py     # browser test (Playwright + Chromium chahiye)
```

## Dhyan rakhne wali baatein
- `service_role` key sirf Vercel env variables mein rahe, kabhi front-end ya GitHub mein nahi.
- Deploy ke baad `schema.sql` ke neeche wala **RLS** wala hissa uncomment karke run kar do, taaki public key se koi data na padh sake (purana Streamlit app band hone ke baad).
- Face matching kitna strict ho, ye teacher screen ke slider se badal sakte ho. Default `0.50` theek hai.
