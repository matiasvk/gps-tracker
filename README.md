# Stride — React GPS Speed & Distance Tracker

A mobile-first React app that uses the browser Geolocation API. It tracks current speed, distance, elapsed trip time, average/top speed, and stores completed trips in `localStorage`.

## Requirements
- Node.js 18+ (20+ recommended)
- A modern browser with location support
- HTTPS for phone deployment. `localhost` is also considered a secure context for development.

## Run locally
1. Extract this folder.
2. Open a terminal in the project folder.
3. Run `npm install`
4. Run `npm run dev`
5. Open the URL printed by Vite.

## Use on a phone
Deploy the project to a static host such as Vercel or Netlify:
1. Push the folder to a Git repository.
2. Import the repository in your hosting provider.
3. Build command: `npm run build`
4. Output directory: `dist`
5. Open the HTTPS URL on your phone and grant location permission.

## Notes
- Keep the page open and active during a trip. Mobile browsers may suspend location updates in the background or when the screen is locked.
- GPS speed and distance are estimates and can be inaccurate indoors, between tall buildings, or with poor satellite reception.
- Trip history is stored only in this browser on this device. Clearing browser site data may delete it.
- Location permission is required. This app does not send GPS coordinates to a server.
