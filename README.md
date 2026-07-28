# DentaTrack — Dental Laboratory Tracking System

A multi-role web app for tracking dental lab cases from prescription to patient handover.

> Demo application. All data is stored locally in your own browser (`localStorage`) —
> nothing is uploaded to a server, and the included cases are fictional sample data.

## Features

**Role switcher** — one dashboard for the dentist, one per registered laboratory.

- **Digital prescription** — interactive 32-tooth chart (FDI / Universal notation),
  restoration categories with dependent material menus, shade guide + shade,
  stump shade, pontic design, STL / photo attachments and notes.
- **5-stage lifecycle** — Still at Clinic → Picked Up by Lab → Work in Progress →
  Work Complete → Clinic Received, with role-gated advance/revert and a full
  timestamped audit history.
- **Handover terminal** — Delivered to Clinic vs Patient Picked Up, with pickup
  date, staff notes and confirmation.
- **Appointment alerts** — cases flagged when the appointment is ≤48h away and the
  work has not yet been received at the clinic.
- **SLA analytics** — turnaround (promised vs actual), on-time delivery rate,
  remake rate, monthly spend and per-lab quality scores.
- **Remake diagnostics** — clinical vs laboratory root-cause logging with a
  breakdown chart.
- **Printable prescription** — A4 print/PDF layout with clinic letterhead,
  tooth diagram and signature block.
- **Share with patient** — generates the prescription PDF in-app and shares it via
  the device share sheet (WhatsApp etc.) or downloads it alongside a pre-filled chat.
- **CSV export** on both dashboards.

## Local development

```bash
npm install
npm run dev
```

Then open http://localhost:5173

To test on a phone on the same network:

```bash
npm run dev -- --host
```

## Build

```bash
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
```

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the app and
publishes `dist/` to GitHub Pages.

## Tech stack

React 18 · Vite · Tailwind CSS · lucide-react · html2canvas + jsPDF (lazy-loaded)
