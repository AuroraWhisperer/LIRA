/*
 * CAT02 white balance and Lift/Gamma/Gain adapted from Unity PostProcessing v1:
 * https://github.com/Unity-Technologies/PostProcessing/tree/933df236f509ed64ae5763ed57af33f2342cd1c2
 * PostProcessing/Runtime/Components/ColorGradingComponent.cs (CalculateColorBalance)
 * PostProcessing/Resources/Shaders/ColorGrading.cginc (WhiteBalance, LiftGammaGain)
 * Changes: JavaScript matrix composition and SVG transfer coefficients, SDR output.
 *
 * The MIT License (MIT)
 * Copyright (c) 2014-2017, Unity Technologies
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

const LINEAR_TO_LMS = [
  [.390405, .549941, .00892632],
  [.0708416, .963172, .00135775],
  [.0231082, .128021, .936245],
];
const LMS_TO_LINEAR = [
  [2.85847, -1.62879, -.024891],
  [-.210182, 1.15820, .000324281],
  [-.041812, -.118169, 1.06867],
];

/** Return a row-major 3×3 linear-RGB CAT02 matrix for validated −100…100 offsets. */
export function whiteBalanceMatrix(temperature, tint) {
  if (!temperature && !tint) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const t1 = temperature / 55, t2 = tint / 55;
  const x = .31271 - t1 * (t1 < 0 ? .1 : .05);
  const y = 2.87 * x - 3 * x * x - .27509507 + t2 * .05;
  const X = x / y, Z = (1 - x - y) / y;
  const white = [.7328 * X + .4296 - .1624 * Z, -.7036 * X + 1.6975 + .0061 * Z, .003 * X + .0136 + .9834 * Z];
  const balance = [.949237, 1.03542, 1.08728].map((value, i) => value / white[i]);
  return LMS_TO_LINEAR.flatMap(row => [0, 1, 2].map(column =>
    row.reduce((sum, value, i) => sum + value * balance[i] * LINEAR_TO_LMS[i][column], 0)));
}

/** Map one channel's validated LGG coefficients to linear-then-power SVG transfers. */
export function liftGammaGainParameters(lift, gamma, gain) {
  return { slope: (1 - lift) * gain, intercept: lift * gain, exponent: 1 / gamma };
}
