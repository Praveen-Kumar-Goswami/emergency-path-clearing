# Emergency Path Clearing - Manual & Automated Test Matrix

Comprehensive test verification guide across the mobile app (Expo Go), web dashboard (Vite React), and test simulator.

---

## 1. Test Matrix

| # | Scenario | Steps to Execute | Expected Result |
|---|---|---|---|
| **1** | **Real phone ahead on route gets alert** | 1. Open mobile app in Citizen mode on device A.<br>2. Enable location sharing.<br>3. Open Ambulance app on device B or start a trip whose route passes in front of device A.<br>4. Ambulance ticks forward within 1 km. | Device A receives a full-screen red emergency overlay with speech audio instruction ("Ambulance approaching, move to left") and vibration every 3s. Dashboard turns vehicle amber. |
| **2** | **Phone behind does not get alert** | 1. Place citizen device or simulator vehicle behind the ambulance's current position on the route.<br>2. Run ambulance tick. | No alert is dispatched to the citizen. Status remains normal (gray marker on dashboard). |
| **3** | **Stationary phone flagged blocking** | 1. Citizen vehicle on route has speed < 8 km/h.<br>2. Ambulance approaches within 1 km ahead. | Alert displays high-urgency message: *"You are blocking the ambulance. Move aside now."* with siren audio prompt. Dashboard displays marker in bright red with `BLOCKING` chip. |
| **4** | **Acknowledge alert works** | 1. Trigger active alert on citizen phone.<br>2. Tap *"I'm moving aside"* button. | Alert overlay switches from flashing red to calm status box with distance countdown. Speech/vibration loop silences. In dashboard, vehicle marker turns green (`ACKNOWLEDGED`). |
| **5** | **Alert clears after ambulance passes** | 1. Ambulance moves past the citizen vehicle's position (vehicle location on route < ambulance location). | Alert row status updates to `cleared`. Citizen screen displays green banner: *"Ambulance has passed. Thank you."* for 4 seconds, then returns to normal view. |
| **6** | **Ending a trip clears alerts** | 1. Have active alerts on citizen devices.<br>2. Ambulance taps *"End emergency trip"* (or arrives within 40m of destination). | `end_trip` RPC executes: trip status becomes `completed`, and all associated active/acknowledged alerts are immediately cleared. Citizen overlays dismiss. |
| **7** | **Killing ambulance app auto-expires trip** | 1. Start an active ambulance trip.<br>2. Force-quit ambulance app or disable GPS.<br>3. Wait 3 minutes. | Database `expire_stale_trips` trigger / RPC marks trip as `expired`. All open alerts clear. Web dashboard displays stale trip warning then removes from active list. |
| **8** | **Offline recovery (Citizen & Dashboard)** | 1. Disconnect Wi-Fi / cellular data on citizen phone or web dashboard.<br>2. Observe offline banner.<br>3. Re-enable network connectivity. | Red offline banner immediately appears. On reconnect, NetInfo / browser online listener re-subscribes to Realtime channels and catches up latest alerts without reloading. |
| **9** | **Two ambulances at once** | 1. Ambulance A starts Trip 1.<br>2. Ambulance B starts Trip 2 on a distinct route.<br>3. Simulator or citizen vehicles positioned along each route. | Web dashboard trip selector lists both active ambulances. Selecting each trip displays its individual route, 1km lookahead corridor, and matching alerted vehicles without cross-trip alert leakage. |

---

## 2. Automated Simulator Verification

The Node.js test script in `/tools/simulator` automatically asserts scenarios 1, 2, 3, and lateral corridors.

### Execution:
1. Start an active trip in the ambulance app (or using "Simulate drive").
2. Run in `/tools/simulator`:
   ```bash
   node simulate.mjs --count 12
   ```
3. Verify live terminal test table:
   - `ahead_moving` -> **PASS (ALERT)**
   - `ahead_blocking` -> **PASS (BLOCKING)**
   - `behind` -> **PASS (NONE)**
   - `opposite` -> **PASS (NONE)**
   - `off_route` -> **PASS (NONE)**
