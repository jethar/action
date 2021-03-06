import {cashay} from 'cashay';
import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {withRouter} from 'react-router-dom';
import {reduxSocket} from 'redux-socket-cluster';
import socketCluster from 'socketcluster-client';
import withAtmosphere from 'universal/decorators/withAtmosphere/withAtmosphere';
import AuthEngine from 'universal/redux/AuthEngine';
import parseChannel from 'universal/utils/parseChannel';

export default (ComposedComponent) => {
  const reduxSocketOptions = (props) => ({
    AuthEngine,
    socketCluster,
    onConnect: (options, hocOptions, socket) => {
      // not worth investigating since socket cluster will be gone soon
      if (!props.atmosphere.socket) {
        props.atmosphere.setSocket(socket);
      }
    },
    onDisconnect: () => {
      cashay.create({priorityTransport: null});
      props.atmosphere.socket = null;
      props.atmosphere.setNet('http');
    },
    keepAlive: 3000
  });

  @withAtmosphere
  @reduxSocket({}, reduxSocketOptions)
  @withRouter
  class SocketWithPresence extends Component {
    static propTypes = {
      dispatch: PropTypes.func,
      match: PropTypes.shape({
        params: PropTypes.shape({
          teamId: PropTypes.string
        })
      }),
      history: PropTypes.object,
      location: PropTypes.shape({
        pathname: PropTypes.string.isRequired
      }),
      user: PropTypes.object
    };

    componentDidMount() {
      this.watchForKickout();
    }

    componentWillUnmount() {
      const socket = socketCluster.connect();
      socket.off('kickOut', this.kickoutHandler);
      socket.off('version', this.versionHandler);
    }

    kickoutHandler = (error, channelName) => {
      const {channel, variableString: teamId} = parseChannel(channelName);
      // important to flag these as unsubscribed so resubs can ocur.
      setTimeout(() => cashay.unsubscribe(channel, teamId), 100);
    };

    watchForKickout() {
      const socket = socketCluster.connect();
      socket.on('kickOut', this.kickoutHandler);
    }

    render() {
      return <ComposedComponent {...this.props} />;
    }
  }

  return SocketWithPresence;
};
