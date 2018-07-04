/* @flow */

import * as React from 'react';
import styled, { injectGlobal } from 'styled-components';
import * as protocol from './protocol';
import * as helpers from './helpers';
import Button from './components/Button';
import Input from './components/Input';
import Address from './components/Address';
import QRCodeDialog from './components/QRCodeDialog';
import Concurrency from './components/Concurrency';
import Posts from './components/Posts';
import Offline from './components/Offline';
import Statistics from './components/Statistics';
import Footer from './components/Footer';

const SAMPLES_COUNT = 3;
const UNAVAILABLE_CHARS = ['0', '2', 'l', 'v'];

const Wrapper = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: ${props => props.theme.colors.b2};
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1 1;

  @media (min-width: 0px) {
    padding: 60px 20px;
  }
  @media (min-width: 576px) {
    padding: 60px 100px;
  }
`;

const Title = styled.h1`
  margin: 0;
  padding: 6px 0;
  font-size: 32px;
  text-align: center;
  color: ${props => props.theme.colors.b0};
`;

const Meta = styled.p`
  margin: 0;
  padding: 6px 0;
  font-size: 20px;
  text-align: center;
  color: ${props => props.theme.colors.b0};
`;

const Description = styled.div`
  padding: 32px 0;
  font-size: 16px;
  text-align: center;
  max-width: 800px;
  color: ${props => props.theme.colors.b0};
`;

const ButtonContainer = styled.div`
  display: flex;
  padding: 32px 0;
`;

const InputContainer = styled.div`
  padding: 0 6px;
  display: flex;
`;

const InputWarning = styled.div`
  padding: 32px 60px;
  font-size: 16px;
  text-align: center;
  max-width: 800px;
  color: red;
`;

const WalletList = styled.div`
  padding: 32px 0;
`;

const ScoreWarning = styled.div`
  font-size: 16px;
  font-style: italic;
  text-align: center;
  padding: 6px 0;
  color: ${props => props.theme.colors.g1};
`;

const Wallet = styled.div`
  display: flex;
  font-size: 12px;
  padding: 6px 0;
  color: ${props => props.theme.colors.b0};
`;

const WalletColumn = styled.div`
  display: flex;
  align-items: center;
  padding: 0 6px;
`;

type Props = {};

type State = {
  running: boolean;
  concurrencyFactor: number;
  unavailableCharsWarning: boolean;
  text: string;
  matches: Array<protocol.Match>;
  qrCodeDialog: ?string;
  stats: helpers.Stats;
};

class Main extends React.Component<Props, State> {
  workers: Array<Worker> = [];
  interval: ?IntervalID = null;
  matchingSamples: Array<number> = [0];
  addressesCount = 0;
  ignoredMatchesCount = 0;
  minIterations = 1;
  numWorkers = 0;

  state = {
    running: false,
    concurrencyFactor: 1,
    unavailableCharsWarning: false,
    text: '',
    matches: [],
    qrCodeDialog: null,
    stats: {
      aps: 0,
      estimatedDuration: 0,
      addressesCount: 0,
      ignoredMatchesCount: 0,
    }
  };

  componentWillMount() {
    injectGlobal`
      @import url('https://fonts.googleapis.com/css?family=Noto+Sans');

      body {
        font-family: Noto Sans;
        overflow-y: scroll;
      }

      body, div, p, h1, h2 {
        padding: 0;
        margin: 0;
      }
    `;
  }

  componentDidMount() {
    if (__BROWSER__) {
      // eslint-disable-next-line no-inline-comments
      import(/* webpackChunkName: "worker" */ 'nanoaddr/worker/index.worker.js').then((AddressWorker) => {
        const cores = helpers.getHardwareConcurrency();
        for (let i = 0; i < cores; i += 1) {
          // $FlowFixMe
          const worker: Worker = new AddressWorker();
          worker.onmessage = this.handleWorkerMessage;
          this.workers.push(worker);
        }
        this.setWorkerConcurrency(1);
      });
    }
  }

  setWorkerConcurrency(factor: number) {
    const cores = helpers.getHardwareConcurrency();
    this.numWorkers = Math.max(1, Math.floor(factor * cores));
  }

  postMessage(message: protocol.WorkerMessage) {
    this.workers.filter((worker, idx) => idx < this.numWorkers).forEach(worker => worker.postMessage(message));
  }

  getStats(): helpers.Stats {
    const sample = this.matchingSamples.reduce((acc, value) => acc + value, 0);
    this.matchingSamples.unshift(0);
    this.matchingSamples.splice(SAMPLES_COUNT);
    const aps = sample / SAMPLES_COUNT;
    const estimatedDuration = aps > 0 ? (this.minIterations / aps) * 1000 : 0;
    return {
      addressesCount: this.addressesCount,
      ignoredMatchesCount: this.ignoredMatchesCount,
      estimatedDuration,
      aps,
    };
  }

  handleConcurrencyFactorChange = (factor: number) => {
    if (!this.state.running) {
      this.setWorkerConcurrency(factor);
      this.setState({
        concurrencyFactor: factor,
      });
    }
  }

  handleWorkerMessage = (event: MessageEvent) => {
    const { data } = event;
    if (data && typeof data === 'object') {
      const message = ((data: any): protocol.AppMessage);
      switch (message.type) {
        case 'match': {
          this.setState(({
            matches: helpers.sortMatches([
              ...this.state.matches,
              message.payload.match,
            ]),
          }));
          break;
        }
        case 'stats': {
          this.addressesCount += message.payload.addresses;
          this.ignoredMatchesCount += message.payload.ignoredMatches;
          this.matchingSamples[0] += message.payload.addresses;
          break;
        }
        default: {
          throw new Error(`Unknown message ${String(message.type)}`);
        }
      }
    }
  }

  handleTextChange = (event: Event) => {
    const inputElement = helpers.as(event.target, HTMLInputElement);
    const { value: text } = inputElement;
    const unavailableCharsWarning = UNAVAILABLE_CHARS.some(char => text.includes(char));
    this.setState({
      unavailableCharsWarning,
      text: inputElement.value,
    });
  }

  handleClick = () => {
    const {
      running,
      text,
    } = this.state;

    const newRunningState = !running;

    if (newRunningState) {
      const terms = helpers.sanitizeTerms(text.split(' '));
      this.minIterations = helpers.getMinSearchIterations(terms);
      this.postMessage({
        type: 'start',
        payload: {
          terms,
        },
      });
      this.interval = setInterval(() => {
        this.setState(() => ({
          stats: this.getStats(),
        }));
      }, 1000);
      this.setState({
        running: newRunningState,
      });
    } else {
      this.postMessage({
        type: 'stop',
      });
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      this.matchingSamples = [0];
      this.setState(() => ({
        running: newRunningState,
        stats: this.getStats(),
      }));
    }
  }

  handleDownload = (match: protocol.Match) => {
    helpers.downloadContent(JSON.stringify(match.wallet), `${match.wallet.address}.json`);
  }

  handleShowAddress = (address: string) => {
    this.setState({
      qrCodeDialog: address,
    });
  }

  handleShowSeed = (seed: string) => {
    this.setState({
      qrCodeDialog: seed,
    });
  }

  handleCloseQRCodeDialog = () => {
    this.setState({
      qrCodeDialog: null,
    });
  }

  render() {
    return (
      <Wrapper>
        <Offline />
        <Container>
          <Title>NanoAddr</Title>
          <Meta>
            {/* eslint-disable-next-line max-len */}
            This service provide a simple way to find your personalized Nano address directly into your browser
          </Meta>
          <Description>
            {/* eslint-disable-next-line max-len */}
            <p>The addresses and private keys are generated directly in your browser without the involvment of any servers and are not transmitted over the Internet. For additional security we still recommend that you disconnect your computer from the Internet while using this site.</p>
          </Description>
          <Concurrency
            currentFactor={this.state.concurrencyFactor}
            onFactorChange={this.handleConcurrencyFactorChange}
          />
          <ButtonContainer>
            <InputContainer>
              <Input
                type="text"
                placeholder="Terms to search"
                value={this.state.text}
                onChange={this.handleTextChange}
              />
            </InputContainer>
            <Button medium disabled={!this.state.text} onClick={this.handleClick}>
              {this.state.running ? 'Stop' : 'Generate'}
            </Button>
          </ButtonContainer>
          {this.state.unavailableCharsWarning && (
            <InputWarning>
              {/* eslint-disable-next-line max-len */}
              <p>You entered some terms that contain some of the letters {UNAVAILABLE_CHARS.map(char => <code key={char}>{char}</code>)} and they seems to not be available in Nano addresses.</p>
            </InputWarning>
          )}
          <Statistics stats={this.state.stats} />
          <WalletList>
            {this.state.stats.ignoredMatchesCount > 0 && (
              <ScoreWarning>
                {/* eslint-disable-next-line max-len */}
                {helpers.formatNumber(this.state.stats.ignoredMatchesCount)} addresses partially matched however they had a very low score.
              </ScoreWarning>
            )}
            {this.state.matches.map(match => (
              <Wallet key={match.wallet.address}>
                <WalletColumn>
                  <Address
                    value={match.wallet.address}
                    highlights={match.score.locations}
                    onClick={() => this.handleShowAddress(match.wallet.address)}
                  />
                </WalletColumn>
                <WalletColumn>
                  <Button
                    small
                    title="Download corresponding seed"
                    onClick={() => this.handleDownload(match)}
                  >
                    Download
                  </Button>
                </WalletColumn>
                <WalletColumn>
                  <Button
                    small
                    title="Show private key as a QR code"
                    onClick={() => this.handleShowSeed(match.wallet.seed)}
                  >
                    Show
                  </Button>
                </WalletColumn>
              </Wallet>
            ))}
          </WalletList>
          <Posts />
          <Footer onShowAddress={this.handleShowAddress} />
        </Container>
        {this.state.qrCodeDialog && (
          <QRCodeDialog
            value={this.state.qrCodeDialog}
            onClose={this.handleCloseQRCodeDialog}
          />
        )}
      </Wrapper>
    );
  }
}

export default Main;
