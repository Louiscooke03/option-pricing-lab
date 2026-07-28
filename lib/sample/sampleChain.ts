import { OptionChain } from '../types';

export const sampleChain: OptionChain = {
  underlying: 'ACME',
  valuationDate: '2026-07-28',
  spot: 100,
  quotes: [
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 80, type: 'call', bid: 20.0, ask: 20.4, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 80, type: 'put', bid: 0.5, ask: 0.7, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 85, type: 'call', bid: 16.2, ask: 16.6, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 85, type: 'put', bid: 0.9, ask: 1.1, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 90, type: 'call', bid: 12.1, ask: 12.4, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 90, type: 'put', bid: 1.6, ask: 1.9, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 95, type: 'call', bid: 8.4, ask: 8.7, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 95, type: 'put', bid: 3.4, ask: 3.7, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 100, type: 'call', bid: 5.2, ask: 5.5, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 100, type: 'put', bid: 5.0, ask: 5.3, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 105, type: 'call', bid: 3.0, ask: 3.3, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 105, type: 'put', bid: 8.1, ask: 8.5, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 110, type: 'call', bid: 1.6, ask: 1.8, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 110, type: 'put', bid: 11.8, ask: 12.2, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 115, type: 'call', bid: 0.9, ask: 1.1, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 115, type: 'put', bid: 15.3, ask: 15.8, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 120, type: 'call', bid: 0.4, ask: 0.6, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-08-21', strike: 120, type: 'put', bid: 19.2, ask: 19.7, spot: 100 },

    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 80, type: 'call', bid: 21.0, ask: 21.4, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 80, type: 'put', bid: 0.7, ask: 0.9, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 85, type: 'call', bid: 17.3, ask: 17.7, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 85, type: 'put', bid: 1.2, ask: 1.4, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 90, type: 'call', bid: 13.1, ask: 13.4, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 90, type: 'put', bid: 2.1, ask: 2.4, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 95, type: 'call', bid: 9.0, ask: 9.3, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 95, type: 'put', bid: 3.9, ask: 4.2, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 100, type: 'call', bid: 5.9, ask: 6.2, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 100, type: 'put', bid: 5.4, ask: 5.8, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 105, type: 'call', bid: 3.8, ask: 4.1, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 105, type: 'put', bid: 8.8, ask: 9.2, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 110, type: 'call', bid: 2.3, ask: 2.6, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 110, type: 'put', bid: 12.2, ask: 12.6, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 115, type: 'call', bid: 1.3, ask: 1.5, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 115, type: 'put', bid: 16.0, ask: 16.4, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 120, type: 'call', bid: 0.7, ask: 0.9, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-09-18', strike: 120, type: 'put', bid: 20.1, ask: 20.6, spot: 100 },

    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 80, type: 'call', bid: 22.6, ask: 23.0, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 80, type: 'put', bid: 0.8, ask: 1.0, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 85, type: 'call', bid: 18.8, ask: 19.2, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 85, type: 'put', bid: 1.4, ask: 1.7, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 90, type: 'call', bid: 14.6, ask: 15.0, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 90, type: 'put', bid: 2.5, ask: 2.8, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 95, type: 'call', bid: 10.5, ask: 10.9, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 95, type: 'put', bid: 4.4, ask: 4.8, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 100, type: 'call', bid: 7.2, ask: 7.6, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 100, type: 'put', bid: 5.9, ask: 6.3, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 105, type: 'call', bid: 4.8, ask: 5.2, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 105, type: 'put', bid: 9.8, ask: 10.2, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 110, type: 'call', bid: 3.2, ask: 3.5, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 110, type: 'put', bid: 13.5, ask: 13.9, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 115, type: 'call', bid: 1.7, ask: 1.9, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 115, type: 'put', bid: 17.1, ask: 17.6, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 120, type: 'call', bid: 1.0, ask: 1.2, spot: 100 },
    { underlying: 'ACME', valuationDate: '2026-07-28', expiry: '2026-12-17', strike: 120, type: 'put', bid: 21.1, ask: 21.6, spot: 100 },
  ],
};

export const sampleChainCSV = `underlying,valuationDate,expiry,strike,type,bid,ask,spot
ACME,2026-07-28,2026-08-21,80,call,20.0,20.4,100
ACME,2026-07-28,2026-08-21,80,put,0.5,0.7,100
ACME,2026-07-28,2026-08-21,85,call,16.2,16.6,100
ACME,2026-07-28,2026-08-21,85,put,0.9,1.1,100
ACME,2026-07-28,2026-08-21,90,call,12.1,12.4,100
ACME,2026-07-28,2026-08-21,90,put,1.6,1.9,100
ACME,2026-07-28,2026-08-21,95,call,8.4,8.7,100
ACME,2026-07-28,2026-08-21,95,put,3.4,3.7,100
ACME,2026-07-28,2026-08-21,100,call,5.2,5.5,100
ACME,2026-07-28,2026-08-21,100,put,5.0,5.3,100
ACME,2026-07-28,2026-08-21,105,call,3.0,3.3,100
ACME,2026-07-28,2026-08-21,105,put,8.1,8.5,100
ACME,2026-07-28,2026-08-21,110,call,1.6,1.8,100
ACME,2026-07-28,2026-08-21,110,put,11.8,12.2,100
ACME,2026-07-28,2026-08-21,115,call,0.9,1.1,100
ACME,2026-07-28,2026-08-21,115,put,15.3,15.8,100
ACME,2026-07-28,2026-08-21,120,call,0.4,0.6,100
ACME,2026-07-28,2026-08-21,120,put,19.2,19.7,100
ACME,2026-07-28,2026-09-18,80,call,21.0,21.4,100
ACME,2026-07-28,2026-09-18,80,put,0.7,0.9,100
ACME,2026-07-28,2026-09-18,85,call,17.3,17.7,100
ACME,2026-07-28,2026-09-18,85,put,1.2,1.4,100
ACME,2026-07-28,2026-09-18,90,call,13.1,13.4,100
ACME,2026-07-28,2026-09-18,90,put,2.1,2.4,100
ACME,2026-07-28,2026-09-18,95,call,9.0,9.3,100
ACME,2026-07-28,2026-09-18,95,put,3.9,4.2,100
ACME,2026-07-28,2026-09-18,100,call,5.9,6.2,100
ACME,2026-07-28,2026-09-18,100,put,5.4,5.8,100
ACME,2026-07-28,2026-09-18,105,call,3.8,4.1,100
ACME,2026-07-28,2026-09-18,105,put,8.8,9.2,100
ACME,2026-07-28,2026-09-18,110,call,2.3,2.6,100
ACME,2026-07-28,2026-09-18,110,put,12.2,12.6,100
ACME,2026-07-28,2026-09-18,115,call,1.3,1.5,100
ACME,2026-07-28,2026-09-18,115,put,16.0,16.4,100
ACME,2026-07-28,2026-09-18,120,call,0.7,0.9,100
ACME,2026-07-28,2026-09-18,120,put,20.1,20.6,100
ACME,2026-07-28,2026-12-17,80,call,22.6,23.0,100
ACME,2026-07-28,2026-12-17,80,put,0.8,1.0,100
ACME,2026-07-28,2026-12-17,85,call,18.8,19.2,100
ACME,2026-07-28,2026-12-17,85,put,1.4,1.7,100
ACME,2026-07-28,2026-12-17,90,call,14.6,15.0,100
ACME,2026-07-28,2026-12-17,90,put,2.5,2.8,100
ACME,2026-07-28,2026-12-17,95,call,10.5,10.9,100
ACME,2026-07-28,2026-12-17,95,put,4.4,4.8,100
ACME,2026-07-28,2026-12-17,100,call,7.2,7.6,100
ACME,2026-07-28,2026-12-17,100,put,5.9,6.3,100
ACME,2026-07-28,2026-12-17,105,call,4.8,5.2,100
ACME,2026-07-28,2026-12-17,105,put,9.8,10.2,100
ACME,2026-07-28,2026-12-17,110,call,3.2,3.5,100
ACME,2026-07-28,2026-12-17,110,put,13.5,13.9,100
ACME,2026-07-28,2026-12-17,115,call,1.7,1.9,100
ACME,2026-07-28,2026-12-17,115,put,17.1,17.6,100
ACME,2026-07-28,2026-12-17,120,call,1.0,1.2,100
ACME,2026-07-28,2026-12-17,120,put,21.1,21.6,100`;
