import type { OfficeState } from '../office/engine/officeState';

/** Use real desk chairs, never couches, as the three operational stations. */
export function stationSeats(office: OfficeState) {
  const chairs = office
    .getLayout()
    .furniture.filter((item) => item.type.includes('CHAIR'))
    .map((item) => item.uid);
  return [...office.seats.values()]
    .filter((seat) => chairs.includes(seat.uid))
    .sort((a, b) => a.seatRow - b.seatRow || a.seatCol - b.seatCol)
    .slice(0, 3);
}
