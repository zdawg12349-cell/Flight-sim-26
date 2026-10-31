// International Standard Atmosphere with weather offsets (temperature deviation, QNH).
const R = 287.053, G0 = 9.80665, T0 = 288.15, P0 = 101325, L = 0.0065;

export function atmosphere(altM, tempOffsetC = 0, qnhHpa = 1013.25, out = {}) {
  const h = Math.max(-500, altM);
  let T, P;
  const p0 = qnhHpa * 100;
  if (h < 11000) {
    T = T0 - L * h;
    P = p0 * Math.pow(T / T0, G0 / (L * R));
  } else {
    const T11 = T0 - L * 11000;
    const P11 = p0 * Math.pow(T11 / T0, G0 / (L * R));
    T = T11;
    P = P11 * Math.exp(-G0 * (h - 11000) / (R * T11));
  }
  T += tempOffsetC;
  out.T = T;                       // K
  out.P = P;                       // Pa
  out.rho = P / (R * T);           // kg/m3
  out.sigma = out.rho / 1.225;
  out.a = Math.sqrt(1.4 * R * T);  // speed of sound
  out.oatC = T - 273.15;
  return out;
}

// Pressure altitude (ft) shown by an altimeter set to `settingHpa` at true altitude altM.
export function indicatedAltitudeFt(altM, qnhHpa, settingHpa) {
  return (altM + (settingHpa - qnhHpa) * 8.43) / 0.3048;   // ~27 ft per hPa
}

// Indicated airspeed (m/s) from true airspeed and density.
export function iasFromTas(tas, rho) { return tas * Math.sqrt(rho / 1.225); }
