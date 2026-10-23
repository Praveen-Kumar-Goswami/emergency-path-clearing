# 5-Minute Live Demo Script: Emergency Path Clearing

This script guides you through demonstrating the complete system end-to-end to judges or stakeholders within 5 minutes.

---

## ⏱️ Pre-Demo Setup (1 minute before)

1. **Web Dashboard**: Open `http://localhost:5173` on a laptop/projector, signed in as `dispatcher1@test.com`.
2. **Phone A (Ambulance)**: Open Expo app, signed in as `ambulance1@test.com`.
3. **Phone B or Simulator (Driver)**: Open Expo app, tapped "I'm a driver", location sharing ON.
4. **Backup Terminal**: Have terminal ready in `/tools/simulator`.

---

## 🎤 Demo Script Timeline

### Minute 0:00 – 1:00 | The Problem & Architecture (Hook)
> **What to say:**
> *"Emergency response times are critically lengthened because drivers only react when an ambulance is right behind them with sirens blaring, often trapped in gridlock with nowhere to go. Today, we've built **Emergency Path Clearing**, a real-time spatial corridor system that warns only drivers directly ahead of an ambulance up to 1 kilometer away, giving them valuable seconds to clear the path."*

- Point to the **Web Dispatch Dashboard**:
  > *"Here is the Dispatch Console. Notice our telemetry pill is LIVE, with real-time PostGIS database synchronization."*

---

### Minute 1:00 – 2:30 | Ambulance Route Setup & Dispatch
- On **Phone A (Ambulance App)**:
  1. Show current GPS position on the Leaflet map.
  2. Search for a destination hospital or tap on the map.
  3. Show the road route calculated via OpenRouteService (with fallback to OSRM), showing route distance and ETA.
  4. Tap **"🚨 START EMERGENCY TRIP"**.

> **What to say:**
> *"The crew selects the destination. The system calculates the exact road geometry and starts the emergency trip. Instantly, the ambulance begins transmitting telemetry every 3 seconds to our PostGIS matching engine."*

- Look at the **Web Dashboard**:
  > *"Notice the Web Dashboard immediately picked up the active trip, drew the route, highlighted the 1 km forward alert zone, and focused the live ambulance marker with its heading-oriented siren icon."*

---

### Minute 2:30 – 3:45 | Traffic Simulator & Citizen Alerts
- In your terminal, run the simulator:
  ```bash
  cd tools/simulator
  node simulate.mjs --count 12
  ```

> **What to say:**
> *"To demonstrate real traffic scenarios without needing 12 physical cars on the road right now, we launch our automated test simulator. It populates 12 vehicles: positive controls ahead of the ambulance, and negative controls behind it, on the opposite lane, and off the route corridor."*

- Show the **Citizen Phone** (or dashboard vehicles):
  > *"Look at Phone B. It is 450 meters ahead of the ambulance on this road. Immediately, a full-screen high-urgency alert fires with audio speech instructing: 'Ambulance approaching, please move to the left' along with haptic vibration."*
  >
  > *"If the vehicle is stopped in traffic under 8 km/h, the system classifies it as 'blocking' and increases urgency."*

- Tap **"I'm moving aside"** on the Citizen Phone:
  > *"The driver confirms they are pulling over. The screen switches to a calm status mode, and on the dispatch dashboard, the marker immediately turns green (Acknowledged)."*

---

### Minute 3:45 – 4:30 | Ambulance Passing & Corridor Clearance
- On Phone A, toggle **"Simulate drive"** at **50 km/h**:
  > *"Watch the ambulance glide along the route. As soon as it overtakes the citizen car, the corridor matcher notices the car is now behind the ambulance. The alert instantly clears, displaying a green 'Ambulance has passed. Thank you' acknowledgment banner."*

- Tap **"End Emergency Trip"** on the ambulance:
  > *"When the crew reaches the hospital and ends the trip, all remaining corridor alerts across all citizen devices instantly terminate."*

---

### Minute 4:30 – 5:00 | Privacy & Closing
> **What to say:**
> *"Finally, privacy was engineered from day one: no location histories or routes are stored for citizens. Every vehicle update completely overwrites the prior row, and records auto-expire after 2 minutes of silence or at the tap of 'Delete my data' in the privacy tab."*

---

## 🛟 Fallback Plan (If Live GPS or Wi-Fi Fails)

If venue Wi-Fi blocks WebSockets or GPS is unavailable inside the building:
1. Turn on **"Simulate drive"** in the Ambulance app (it bypasses GPS and generates smooth simulated movement along the polyline).
2. Use `node simulate.mjs` in `/tools/simulator` (all simulated vehicles communicate over standard HTTPS REST / Supabase RPCs, resilient to weak signals).
3. The Web Dashboard continues updating every 2 seconds via its polling fail-safe.
