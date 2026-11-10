import type { Appliance } from './plan.ts';

// Typical figures; the energy label on your own machine is better, and every value is editable on the site.
// Dishwasher: eco programme, 13 place settings (EU energy label range 0.7-1.0 kWh per cycle).
// Washing machine: eco 40-60 programme, 8 kg (EU label range 0.5-0.9 kWh per cycle).
// Tumble dryer: heat-pump dryer, full 8 kg load (about 1.5-2.2 kWh; a condenser dryer uses about twice as much).
// EV: 7 kW home charger for 4 hours = 28 kWh, roughly 100 miles at 3.5 miles per kWh.
export const APPLIANCES: Appliance[] = [
  { id: 'dishwasher', name: 'Dishwasher', kWh: 0.9, slots: 6, perWeek: 5 },
  { id: 'washer', name: 'Washing machine', kWh: 0.7, slots: 6, perWeek: 4 },
  { id: 'dryer', name: 'Tumble dryer', kWh: 2, slots: 4, perWeek: 2 },
  { id: 'ev', name: 'Electric car', kWh: 28, slots: 8, perWeek: 2 },
];
