// The sums of the page week.html, away from the page's own thread: a day with many players takes a second or two
// to work out, and the page must not stand still meanwhile. Started with the week's settings, then asked for one
// day after another; every answer is the day's numbers, where every player stands, and where all the NEAR is.
import { makeWeek } from './week.js';

let week = null;
self.onmessage = ({ data }) => {
  if (data.start) week = makeWeek(data.start);
  else if (data.day) self.postMessage({ day: week.playDay(), boats: week.standing(), money: week.money() });
};
