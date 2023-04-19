import { BigNumberish } from "ethers";
import { format } from "date-fns";

export function timestampToDate(ts: BigNumberish) {
  return new Date(parseInt(ts.toString()) * 1000);
}

export function dateToStr(d: Date) {
  return format(d, 'yyyy-MM-dd HH:mm:ss');
}

export function timestampToDateStr(ts: BigNumberish) {
  const date = timestampToDate(ts);
  return dateToStr(date);
}
