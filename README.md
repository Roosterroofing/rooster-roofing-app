# Rooster Roofing App (v18)

A full-stack business management application tailored for roofing companies. This tool centralizes customer management, job estimation, profit analysis, commission tracking, and subcontractor payroll into a single cloud-synced dashboard.

## 🛠 Tech Stack
* **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+)
* **Styling:** Bootstrap 5.3, Material Design Icons, Google Fonts (Manrope)
* **Backend as a Service (BaaS):** Firebase v9.23.0 (Compat API)
  * Firebase Auth (Role-based access control)
  * Firestore (Real-time database for customers, estimates, and settings)
  * Firebase Storage (Avatar uploads)
* **Integrations & Libraries:** 
  * Chart.js (Dashboard analytics)
  * FullCalendar (Payroll scheduling)
  * Picmo (Team chat emoji picker)
  * Google Apps Script Webhook (Direct Google Drive document uploads)[cite: 1, 2]

## 📂 Project Structure
The repository follows a lightweight vanilla web stack architecture:
* \`index.html\`
  * Contains the core application layout, login overlays, modal structures, and UI templates for all views (Dashboard, Calculator, Customers, Settings, Payroll, Commissions, Chat).
* \`styles.css\`
  * Contains custom UI overrides, dynamic print layouts (supporting various report types like Commission Statements and Payroll Slips), and chat widget styling.
* \`script.js\`
  * Handles application logic, DOM manipulation, Firebase data syncing, dynamic calculator math, report generation, and automated notifications.[cite: 1, 2, 3]

## ⚙️ Initial Setup & Configuration

### 1. Firebase Configuration
The application relies on Firebase for authentication and database management. 
1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Authentication** (Email/Password).
3. Enable **Firestore Database** and **Storage**.
4. In `script.js`, locate the `firebaseConfig` object and replace it with your production environment variables:
   ```javascript
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
     databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
     messagingSenderId: "YOUR_SENDER_ID",
     appId: "YOUR_APP_ID"
   };

   2. Google Drive Integration (Apps Script)The app uploads customer documents directly to Google Drive via a webhook.Create a new Google Apps Script.Configure it to accept base64 file payloads and save them to a specific Google Drive folder.Deploy the script as a Web App (accessible by anyone).Update the GOOGLE_DRIVE_WEBHOOK_URL constant at the top of script.js with your deployed Web App URL.   3. Local DevelopmentBecause the app uses vanilla HTML/JS/CSS without a build step, you can serve it locally using any standard HTTP server.Using Python: python -m http.server 8000Using Node (http-server): npx http-serverUsing VS Code: Launch with the "Live Server" extension.4. Admin Access ProvisioningAdministrative capabilities (access to global settings, payroll, and commission ledgers) are hardcoded for specific emails.To grant Admin access to new developers or managers, add their email to the adminEmails array inside the completeLogin(user) function in script.js.
