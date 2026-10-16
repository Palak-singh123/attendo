# Attendo AI — Smart Attendance Management System

**Automate attendance. Reduce manual work. Track student performance.**

Attendo AI is a smart attendance management web application designed to simplify classroom attendance using face recognition, voice-assisted attendance, QR-based student enrollment, and attendance analytics. Teachers can manage students and subjects, review attendance records, and generate reports, while students can track their attendance and monitor their progress.

🌐 **Live Demo:** [Attendo AI](https://attendo-dwtb.vercel.app/)  
📂 **GitHub Repository:** [Palak-singh123/attendo](https://github.com/Palak-singh123/attendo)

---

## ✨ Features

### 🤖 Smart Attendance
- **Face Recognition:** Identify enrolled students from classroom photos or camera input.
- **Voice-Assisted Attendance:** Use browser speech recognition to process spoken attendance phrases.
- **Manual Attendance:** Mark students present or absent before saving records.
- **Attendance Review:** Verify and edit recognized attendance before final submission.
- **Multiple Input Sources:** Capture images using a camera or upload existing photos.
- **Duplicate Attendance Warning:** Help prevent duplicate records for the same day.

### 👩‍🏫 Teacher Dashboard
- Manage students, subjects, and enrollments.
- Generate QR codes and shareable links for student enrollment.
- View student-wise attendance percentages and trends.
- Identify students with attendance below 75%.
- Edit or delete attendance sessions.
- Export attendance records as CSV and print reports.

### 🎓 Student Dashboard
- View attendance percentage and attendance history.
- Monitor attendance trends and missed classes.
- Set a personal attendance target.
- Update face samples to support recognition.

### 🎨 Modern User Experience
- Responsive interface for desktop and mobile devices.
- Dark mode support.
- Progressive Web App (PWA) support for installation on compatible devices.
- Secure, server-side API integration with Supabase.

---

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| HTML5 | Application structure |
| CSS3 | Responsive styling and UI |
| Vanilla JavaScript | Frontend functionality |
| face-api.js | Browser-based face detection and recognition components |
| Web Speech API | Voice-assisted attendance |
| Node.js | Server-side JavaScript runtime |
| Vercel Serverless Functions | Backend API and deployment |
| Supabase | PostgreSQL database and data management |
| bcrypt | Password hashing |
| PWA | Installable web application experience |

---

## 🏗️ Project Architecture

```text
Attendo AI
│
├── index.html              # Main application
├── css/                    # Stylesheets
├── js/                     # Frontend logic
├── assets/                 # Images and static assets
├── api/
│   └── rpc.js              # Serverless API endpoint
├── lib/                    # Backend utilities
├── supabase/
│   └── schema.sql          # Database setup
├── tests/
│   ├── api.test.js         # API tests
│   ├── e2e.py              # End-to-end tests
│   └── e2e-server.js       # Test server
├── .env.example            # Environment variable template
├── package.json            # Project configuration
├── vercel.json             # Vercel configuration
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

Before running the project, ensure you have:

- [Node.js](https://nodejs.org/) and npm installed.
- A [Supabase](https://supabase.com/) account.
- A [Vercel](https://vercel.com/) account for deployment.
- Git installed on your system.

### 1. Clone the Repository

```bash
git clone https://github.com/Palak-singh123/attendo.git
cd attendo
```

### 2. Configure Supabase

1. Create or open your Supabase project.
2. Navigate to **SQL Editor**.
3. Open `supabase/schema.sql` from this repository.
4. Execute the required SQL statements.
5. Open **Project Settings → API** and copy your Project URL and service-role key.

Review the SQL script before executing it, particularly if you are using an existing database.

### 3. Configure Environment Variables

Create a `.env` file in the project root for local development, using `.env.example` as a reference.

Configure the following variables:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Secret service-role key for server-side database access |
| `SESSION_SECRET` | A long, random secret used for session security |

Use your actual credentials locally. Never commit `.env` or expose the service-role key in frontend JavaScript, public repositories, or client-side environment variables.

### 4. Run Locally

Install the Vercel CLI if it is not already installed:

```bash
npm install -g vercel
```

Configure the environment variables for local development, then run:

```bash
vercel dev
```

Open the local URL shown in your terminal.

**Note:** Camera and microphone functionality generally requires HTTPS or a trusted localhost origin, as well as browser permissions.

---

## ☁️ Deployment on Vercel

1. Push the project to your GitHub repository.
2. Sign in to [Vercel](https://vercel.com/).
3. Select **Add New → Project**.
4. Import `Palak-singh123/attendo`.
5. Select **Other** as the framework preset if required by the project configuration.
6. Add the required environment variables in Vercel Project Settings.
7. Deploy the application.

After deployment, verify the API health endpoint:

```text
https://YOUR-SITE.vercel.app/api/rpc?action=health
```

Replace `YOUR-SITE` with your actual Vercel deployment hostname. Check the response to confirm that the backend can initialize correctly.

---

## 📱 How to Use Attendo

### For Teachers

1. Open the application and access the teacher account.
2. Create or select a subject.
3. Add students or share the enrollment link or QR code.
4. Start an attendance session.
5. Capture or upload classroom images, or use the available attendance modes.
6. Review and correct the attendance results.
7. Save the session and explore attendance reports.

### For Students

1. Join a subject using the enrollment link or QR code.
2. Complete the required registration process.
3. Use the supported attendance method when instructed.
4. Open the student dashboard to monitor attendance and progress.

*Exact screens and available actions depend on the deployed application version.*

---

## 🧪 Testing

The repository includes automated testing utilities for API and browser workflows.

### API Tests

```bash
node tests/api.test.js
```

### End-to-End Tests

The browser test requires the relevant Python dependencies, Playwright, and a compatible Chromium installation.

```bash
python3 tests/e2e.py
```

Run tests in your local development environment and verify their prerequisites before interpreting the results.

---

## 🔐 Security and Privacy

- Keep Supabase service-role credentials exclusively on the server.
- Store sensitive environment variables in local environment files or Vercel environment settings.
- Do not commit credentials, student records, or biometric data to GitHub.
- Configure appropriate Supabase Row Level Security (RLS) policies and access controls.
- Restrict access to student attendance records and face-related data.
- Obtain appropriate consent before collecting or processing student images or voice input.
- Use HTTPS in deployed environments and review session management and authentication controls before production use.

Face recognition and speech recognition are subject to image quality, lighting, browser compatibility, microphone permissions, and recognition errors. Always review attendance results before saving them.

---

## 🔮 Future Enhancements

Potential improvements include:

- Improved recognition accuracy in crowded classrooms.
- More detailed attendance analytics and downloadable reports.
- Notifications for students with low attendance.
- Advanced role-based access control.
- Enhanced accessibility and multilingual support.
- Additional privacy controls and biometric data lifecycle management.

---

## 🎯 Project Objective

Attendo AI aims to make attendance management more efficient, accessible, and data-driven by combining web technologies with intelligent recognition features. It reduces repetitive administrative work and helps teachers and students make better use of attendance information.

---

## 👩‍💻 Author

**Palak Singh**

B.Tech Computer Science and Engineering

- GitHub: [@Palak-singh123](https://github.com/Palak-singh123)

---

## 📄 License

No license has been specified here. Add a `LICENSE` file to the repository if you intend to distribute the project under an open-source license.

---

**If you find Attendo AI useful, consider giving the repository a ⭐ on GitHub!**
