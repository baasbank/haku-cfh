angular.module('mean.system')
  .factory('game', ['socket', '$timeout', '$http', '$window', function (socket, $timeout, $http, $window) {
    const game = {
      id: null, // This player's socket ID, so we know who this player is
      gameID: null,
      players: [],
      playerIndex: 0,
      winningCard: -1,
      winningCardPlayer: -1,
      gameWinner: -1,
      table: [],
      czar: null,
      playerMinLimit: 3,
      playerMaxLimit: 12,
      pointLimit: null,
      state: null,
      round: 0,
      time: 0,
      curQuestion: null,
      notification: null,
      timeLimits: {},
      joinOverride: false,
      gameOwner: null,
      gameOwnerId: null
    };

    const notificationQueue = [];
    let timeout = false;
    const self = this;
    let joinOverrideTimeout = 0;

    const addToNotificationQueue = function (msg) {
      notificationQueue.push(msg);
      if (!timeout) { // Start a cycle if there isn't one
        setNotification();
      }
    };
    var setNotification = function () {
      if (notificationQueue.length === 0) { // If notificationQueue is empty, stop
        clearInterval(timeout);
        timeout = false;
        game.notification = '';
      } else {
        game.notification = notificationQueue.shift(); // Show a notification and check again in a bit
        timeout = $timeout(setNotification, 1300);
      }
    };

    let timeSetViaUpdate = false;
    var decrementTime = function () {
      if (game.time > 0 && !timeSetViaUpdate) {
        game.time--;
      } else {
        timeSetViaUpdate = false;
      }
      $timeout(decrementTime, 950);
    };

    socket.on('id', (data) => {
      game.id = data.id;
    });

    socket.on('prepareGame', (data) => {
      game.playerMinLimit = data.playerMinLimit;
      game.playerMaxLimit = data.playerMaxLimit;
      game.pointLimit = data.pointLimit;
      game.timeLimits = data.timeLimits;
    });

    socket.on('gamestarted', () => {
      game.state = 'game started';
    });

    socket.on('gameUpdate', (data) => {
    // Update gameID field only if it changed.
    // That way, we don't trigger the $scope.$watch too often
      if (game.gameID !== data.gameID) {
        game.gameID = data.gameID;
      }

      game.joinOverride = false;
      clearTimeout(game.joinOverrideTimeout);

      let i;
    // Cache the index of the player in the players array
      for (i = 0; i < data.players.length; i++) {
        if (game.id === data.players[i].socketID) {
          game.playerIndex = i;
        }
      }

      const newState = (data.state !== game.state);

    // Handle updating game.time
      if (data.round !== game.round && data.state !== 'awaiting players' &&
      data.state !== 'game ended' && data.state !== 'game dissolved') {
        game.time = game.timeLimits.stateChoosing - 1;
        timeSetViaUpdate = true;
      } else if (newState && data.state === 'waiting for czar to decide') {
        game.time = game.timeLimits.stateJudging - 1;
        timeSetViaUpdate = true;
      } else if (newState && data.state === 'winner has been chosen') {
        game.time = game.timeLimits.stateResults - 1;
        timeSetViaUpdate = true;
      }

    // Set these properties on each update
      game.round = data.round;
      game.winningCard = data.winningCard;
      game.winningCardPlayer = data.winningCardPlayer;
      game.winnerAutopicked = data.winnerAutopicked;
      game.gameWinner = data.gameWinner;
      game.pointLimit = data.pointLimit;

    // Handle updating game.table
      if (data.table.length === 0) {
        game.table = [];
      } else {
        const added = _.difference(_.pluck(data.table, 'player'), _.pluck(game.table, 'player'));
        const removed = _.difference(_.pluck(game.table, 'player'), _.pluck(data.table, 'player'));
        for (i = 0; i < added.length; i++) {
          for (let j = 0; j < data.table.length; j++) {
            if (added[i] === data.table[j].player) {
              game.table.push(data.table[j], 1);
            }
          }
        }
        for (i = 0; i < removed.length; i++) {
          for (let k = 0; k < game.table.length; k++) {
            if (removed[i] === game.table[k].player) {
              game.table.splice(k, 1);
            }
          }
        }
      }

      if (game.state !== 'waiting for players to pick' || game.players.length !== data.players.length) {
        game.players = data.players;
      }

      if (newState || game.curQuestion !== data.curQuestion) {
        game.state = data.state;
      }

      if (data.state === 'czar pick card') {
        game.czar = data.czar;
        if (game.czar === game.playerIndex) {
          addToNotificationQueue(
            `You are now a Czar, 
            click black card to pop a new question`
          );
        } else {
          addToNotificationQueue('Waiting for Czar to pick card');
        }
      } else if (data.state === 'waiting for players to pick') {
        game.czar = data.czar;

        game.curQuestion = data.curQuestion;
      // Extending the underscore within the question
        game.curQuestion.text = data.curQuestion.text.replace(/_/g, '<u></u>');

      // Set notifications only when entering state
        if (newState) {
          if (game.czar === game.playerIndex) {
            addToNotificationQueue('You\'re the Card Czar! Please wait!');
          } else if (game.curQuestion.numAnswers === 1) {
            addToNotificationQueue('Select an answer!');
          } else {
            addToNotificationQueue('Select TWO answers!');
          }
        }
      } else if (data.state === 'waiting for czar to decide') {
        if (game.czar === game.playerIndex) {
          addToNotificationQueue("Everyone's done. Choose the winner!");
        } else {
          addToNotificationQueue('The czar is contemplating...');
        }
      } else if (data.state === 'winner has been chosen' &&
              game.curQuestion.text.indexOf('<u></u>') > -1) {
        game.curQuestion = data.curQuestion;
      } else if (data.state === 'awaiting players') {
        joinOverrideTimeout = $timeout(() => {
          game.joinOverride = true;
        }, 15000);
      } else if (data.state === 'game dissolved' || data.state === 'game ended') {
        if (data.state !== 'game dissolved') {
          
          const gamePlayers = [];
          Object.keys(game.players).map(player => gamePlayers.push({
            username: game.players[player].username,
            points: game.players[player].points,
            userID: game.players[player].userID,
          }));
          const gameWinner = {
            username: game.players[game.gameWinner].username,
            userID: game.players[game.gameWinner].userID
          };
          const gameOwner = {
            username: game.players[0].username,
            userID: game.players[0].userID,
          };
          const gameRound = game.round;
          const gameId = game.gameID;
          const gameEnded = true;
          const timePlayed = new Date().toUTCString();
          const loggedInUserID = user._id;
          const gameDetails = {
            gameId,
            gameRound,
            gameOwner,
            gameWinner,
            gamePlayers,
            gameEnded,
            timePlayed
          };

          if (gameDetails.gameOwner.userID === loggedInUserID) {
            $http.post(`/api/games/${game.gameID}/start`, gameDetails);
            $http.put('/api/users/gameupdate', gameDetails);
          }
        }
        game.players[game.playerIndex].hand = [];
        game.time = 0;
      }
    });

    socket.on('notification', (data) => {
      addToNotificationQueue(data.notification);
    });

    game.joinGame = function (mode, room, createPrivate) {
      mode = mode || 'joinGame';
      room = room || '';
      createPrivate = createPrivate || false;

      if (localStorage.user) {
        $window.user = JSON.parse(localStorage.user);
      }
      const userID = $window.user ? $window.user._id : 'unauthenticated';
      socket.emit(mode, { userID, room, createPrivate });
    };

    game.startGame = function () {
      socket.emit('startGame');
    };

    game.leaveGame = function () {
      game.players = [];
      game.time = 0;
      socket.emit('leaveGame');
    };

    game.pickCards = function (cards) {
      socket.emit('pickCards', { cards });
    };

    game.pickWinning = function (card) {
      socket.emit('pickWinning', { card: card.id });
    };

    game.startNextRound = () => {
      socket.emit('czarCardSelected');
    };

    decrementTime();

    return game;
  }]);
