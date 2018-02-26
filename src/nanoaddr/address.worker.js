/* @flow */

import * as protocol from './protocol';
import * as helpers from './helpers';

const BATCH_SIZE = 40;

let running = false;
let count = 0;
let interval: ?IntervalID = null;

function reportAPS(aps: number): void {
  // $FlowFixMe
  postMessage({
    type: 'aps',
    payload: {
      aps,
    },
  });
}

function reportMatch(match: protocol.Match): void {
  // $FlowFixMe
  postMessage({
    type: 'match',
    payload: {
      match,
    },
  });
}

function search(text: string): void {
  count += 1;
  const arr = helpers.getSeedArray();
  self.crypto.getRandomValues(arr);
  const wallet = helpers.randomWallet(arr);
  const score = helpers.getScore(wallet, text);
  if (score > 0) {
    if (helpers.isAddressValid(wallet.address)) {
      reportMatch({ wallet, score });
    }
  }
}

function searchBatch(text: string): void {
  setTimeout(() => {
    if (running) {
      for (let i = 0; i < BATCH_SIZE; i += 1) {
        search(text);
      }
      searchBatch(text);
    }
  }, 0);
}

onmessage = (event) => {
  switch (event.data.type) {
    case 'start': {
      if (!running) {
        running = true;
        searchBatch(event.data.payload.text);
        interval = setInterval(() => {
          reportAPS(count);
          count = 0;
        }, 1000);
      }
      break;
    }

    case 'stop': {
      running = false;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      break;
    }

    default: {
      throw new Error(`Unknown message ${String(event.data.type)}`);
    }
  }
}
