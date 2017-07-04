/**
 *  Created by Orion Wolf_Hubbard on 6/4/2017.
 */

//server
let app = require('express')();
let http = require('http').Server(app);
let io = require('socket.io')(http);
let port = process.env.PORT || 3000;
app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html') });
http.listen(port,() => { console.log('listening on *:' + port) });

//database
let pg = require('pg');
pg.defaults.ssl = true;
let client = new pg.Client(process.env.DATABASE_URL);
client.connect();

let userMap = {};
let lobby = {};
let passwordMap = {};
let ratingMap = {};
let gamesCountMap = {};
let slapsMap = {};
let tables = {};
let games = {};
let online = [];
//ELO K value
const K = 110;
//get users info
client.query('SELECT * FROM users;').on('row', row => {
    passwordMap[row.name] = row.pass;
    ratingMap[row.name] = row.rating;
    gamesCountMap[row.name] = row.games;
    slapsMap[row.name] = row.slaps;
});

let newTable = function () {
    this.player1 = null;
    this.player2 = null;
    this.player3 = null;
    this.player4 = null;
    this.sandwich = 'off';
    this.run = 'off';
    this.bottomTop = 'off';
    this.jokers = 'off';
    this.flush = 'off';
    this.timeout = 'two';
    this.double = 'on';
    this.sumten = 'off';
    this.quit = 'distribute';
};

let newPlayer = function (name, userId) {
    this.name = name;
    this.userId = userId;
    this.ready = 'not ready';
    this.cards = null;
    this.pauseTill = 0;
};

let slaps = function (name) {
    this.name = name;
    this.slaps = 0;
    this.rating = 0;
};

let newUser = function (userId) {
    this.name = 'GUEST';
    this.tableId = 'none';
    this.userId = userId;
};

//this holds all the functions that deal with information coming from the clients
io.on('connection', socket => {
    let userId = socket.id;
    io.to(userId).emit('setup_login');
    userMap[userId] = new newUser(userId);
    let user = userMap[userId];
    
    //handles chat and $commands
    socket.on('chat', text => {
        if (text.indexOf('$slaps') !== -1 && user.tableId in games) {
            let game = games[user.tableId];
            let msg = `<p>total slaps: ${game.slaps}</p>`;
            for (let i = 1; i < 5; i++)
                if (`player${i}slaps` in game) {
                    let player = game[`player${i}slaps`];
                    msg += `<p>${player.name} got ${player.slaps} slaps</p>`;
                }
            io.to(userId).emit('chat',msg);
        } else if (text.indexOf('$rules') !== -1 && user.tableId in games) {
            io.to(userId).emit('chat', htmlRules(user.tableId));
        } else if (text.indexOf('$scores') !== -1) {
            io.to(userId).emit('ratings', topFive());
        } else io.sockets.emit('chat',text);
    });
    
    socket.on('login', loginInfo => {
        let NAME = 0, PASS = 1;
        if (online.indexOf(loginInfo[NAME]) === -1) {
            if (loginInfo[NAME] in passwordMap) {
                if (passwordMap[loginInfo[NAME]] === loginInfo[PASS]) {
                    userMap[userId].name = loginInfo[NAME];
                    for (let id in userMap) io.to(id).emit('chat', `<p>${loginInfo[NAME]} logging in</p>`);
                } else {
                    //resend 'login_setup' on fail
                    io.to(userId).emit('login_setup');
                }
            } else {
                //if username doesn't already exist add it and login
                for (let id in userMap) io.to(id).emit('chat', `<p>${loginInfo[NAME]} logging in</p>`);
                client.query(`INSERT INTO users (name, pass, rating, games, slaps) VALUES ('${loginInfo[NAME]}', '${loginInfo[PASS]}', 1500, 0, 0)`);
                gamesCountMap[loginInfo[NAME]] = 0;
                slapsMap[loginInfo[NAME]] = 0;
                ratingMap[loginInfo[NAME]] = 1500;
                passwordMap[loginInfo[NAME]] = loginInfo[PASS];
                userMap[userId].name = loginInfo[NAME];
            }
            //if the user's name has been changed, they are logged in, emit 'lobby_setup'
            if (user.name !== 'GUEST') {
                online.push(user.name);
                io.to(userId).emit('set_name', user.name);
                lobby[userId] = user.name;
                for (let key in lobby)
                    io.to(key).emit('lobby', tables);
            }
        }
    });
    
    socket.on('disconnect', () => {
        //remove from online array
        let index = online.indexOf(user.name);
        online.splice(index,1);
        
        for (let id in userMap) io.to(id).emit('chat', `<p>${userMap[userId].name} logging off</p>`);
        //if the user has joined a table, remove them
        if(user.tableId !== 'none'){
            let player;
            if (user.tableId in tables) {
                //find the player#
                let table = tables[user.tableId];
                for (let i = 1; i < 5; i++) {
                    let p = 'player' + i;
                    if (table[p] !== null)
                        if (table[p].userId === userId)
                            player = p;
                }
                table[player] = null;
                //check if anyone is still at the table, update table if so, delete table if not
                let empty = true;
                for (let i = 1; i < 5; i++) {
                    let p = 'player' + i;
                    if (table[p] !== null) empty = false;
                }
                if (empty) {
                    delete tables[user.tableId];
                } else {
                    for (let i = 1; i < 5; i++) {
                        let p = 'player' + i;
                        if (table[p] !== null)
                            io.to(table[p].userId).emit('table', [table, p]);
                    }
                }
                for (let key in lobby) io.to(key).emit('lobby', tables );
            } else {
                //find  the player#, get player count
                let count = 0;
                let table = games[user.tableId];
                for (let i = 1; i < 5; i++) {
                    let p = 'player' + i;
                    if (table[p] !== null) {
                        if (table[p].userId === userId)
                            player = p;
                        count++;
                    }
                }
                if (count > 2) {
                    removeFromGame(user.tableId, player);
                    for (let i = 1; i < 5; i++) {
                        let p = 'player' + i;
                        if (table[p] !== null) {
                            io.to(table[p].userId).emit('game_info', table);
                        }
                    }
                } else {
                    table[player] = null;
                    endGame(user.tableId);
                }
            }
        }
        delete userMap[userId];
    });
    
    //when attempt is made to join a table
    socket.on('join_table', tableId => {
        //new table
        if (tableId === 'new') {
            //make new table, add player to it
            tableId = Math.random().toString(36).substr(2, 5);
            tables[tableId] = new newTable();
            let table = tables[tableId];
            user.tableId = tableId;
            table.player1 = new newPlayer(user.name, userId);
            //remove user from lobby and update lobby
            delete lobby[userId];
            for (let key in lobby) io.to(key).emit('lobby', tables );
            //setup table wait area for player
            io.to(userId).emit('setup_table', 'player1');
            //emit table to players in table
            for (let i = 1; i < 5; i++) {
                let p = 'player' + i;
                if (table[p] !== null)
                    io.to(table[p].userId).emit('table', [table, p]);
            }
        } else {
            //join existing table
            let table = tables[tableId];
            let added = false;
            
            for (let i = 1; i < 5; i++) {
                let seat = 'player' + i;
                //if that player is null
                if (table[seat] === null) {
                    //setup table wait area for player
                    io.to(userId).emit('setup_table', seat);
                    //add the player
                    user.tableId = tableId;
                    table[seat] = new newPlayer(user.name, userId);
                    //flip the boolean
                    added = true;
                    delete lobby[userId];
                    //exit the loop
                    i = 42;
                }
            }
            //if the user was added
            if (added) {
                // update table for table recipients
                for (let i = 1; i < 5; i++) {
                    let p = 'player' + i;
                    if (table[p] !== null)
                        io.to(table[p].userId).emit('table', table);
                }
                //remove from lobby and update lobby for lobby recipients
                delete lobby[userId];
                for (let key in lobby) io.to(key).emit('lobby', tables );
            }
        }
    });
    
    //when player hits ready button at table
    socket.on('ready', player => {
        let table = tables[user.tableId];
        //flip player's ready property
        if (table[player].ready === 'not ready')
            table[player].ready = 'ready';
        else table[player].ready = 'not ready';
        //update clients in table
        for (let i = 1; i < 5; i++) {
            let p = 'player' + i;
            if (table[p] !== null)
                io.to(table[p].userId).emit('table', table);
        }
        //check if all players are ready
        let ready = 0;
        let total = 0;
        for (let i = 1; i < 5; i++) {
            let p = 'player' + i;
            if (table[p] !== null) {
                total++;
                if (table[p].ready === 'ready')
                    ready++;
            }
        }
        if (total > 1 && ready === total) newGame(user.tableId);
    });
    
    //when a player plays a card
    socket.on('play_card', () => {
        let game = games[user.tableId];
        let player = user.playerNumber;
        let card = game[player].cards[0];
        if (game[player].ready) {
            //if someone played a face/ace
            if (game.facePlayer !== 'none') {
                //if player plays a face/ace
                if ((card[0] > 12 || card[0] === 1)) {///code change check it
                    //change facePlayer and set triesLeft
                    game.facePlayer = player;
                    if (card[0] === 1) game.triesLeft = 4;
                    else if (card[0] === 13) game.triesLeft = 1;
                    else if (card[0] === 14) game.triesLeft = 2;
                    else if (card[0] === 15) game.triesLeft = 3;
                    //add the card to game pile
                    game.pile.push(card);
                    //remove the card from player cards
                    game[user.playerNumber].cards.splice(0, 1);
                    //next player's turn
                    nextPlayer(user.tableId);
                    //update
                    for (let i = 1; i < 5; i++) {
                        let p = 'player' + i;
                        if (game[p] !== null)
                            io.to(game[p].userId).emit('game_info', game);
                    }
                } else if (game.triesLeft === 1 || game[player].cards.length === 1) {
                    //no-ones turn, wait for player to claim pile or slap
                    game[player].ready = false;
                    game.roundOver = true;
                    //add the card to game pile
                    game.pile.push(card);
                    //remove the card from player cards
                    game[player].cards.splice(0, 1);
                    //update game
                    for (let i = 1; i < 5; i++) {
                        let p = 'player' + i;
                        if (game[p] !== null)
                            io.to(game[p].userId).emit('game_info', game);
                    }
                } else { //player goes again
                    game.triesLeft--;
                    //add the card to game pile
                    game.pile.push(card);
                    //remove the card from player cards
                    game[user.playerNumber].cards.splice(0, 1);
                    //update game
                    for (let i = 1; i < 5; i++) {
                        let p = 'player' + i;
                        if (game[p] !== null)
                            io.to(game[p].userId).emit('game_info', game);
                    }
                }
            } else {
                //if player plays a face/ace
                if (card[0] > 12 || card[0] === 1) {
                    //change facePlayer and set triesLeft
                    game.facePlayer = player;
                    if (card[0] === 1) game.triesLeft = 4;
                    else if (card[0] === 13) game.triesLeft = 1;
                    else if (card[0] === 14) game.triesLeft = 2;
                    else if (card[0] === 15) game.triesLeft = 3;
                    //add the card to game pile
                    game.pile.push(card);
                    //remove the card from player cards
                    game[user.playerNumber].cards.splice(0, 1);
                    //next player's turn
                    nextPlayer(user.tableId);
                    //update
                    for (let i = 1; i < 5; i++) {
                        let p = 'player' + i;
                        if (game[p] !== null)
                            io.to(game[p].userId).emit('game_info', game);
                    }
                    //if player is out of cards or tries
                } else {
                    game.pile.push(card);
                    //remove the card from player cards
                    game[user.playerNumber].cards.splice(0, 1);
                    //change turns
                    nextPlayer(user.tableId);
                    //emit game to players
                    for (let i = 1; i < 5; i++) {
                        let p = 'player' + i;
                        if (game[p] !== null)
                            io.to(game[p].userId).emit('game_info', game);
                    }
                }
            }
            //check if game is over (3 players have no cards)
            let counter = 0;
            let players = 0;
            for (let i = 1; i < 5; i++) {
                let p = 'player' + i;
                if (game[p] !== null) {
                    players++;
                    if (game[p].cards.length === 0)
                        counter++;
                }
            }
            if (counter === players - 1)
                endGame(user.tableId);
        }
    });
    
    //emit from client when it is their turn and they have no cards
    socket.on('no_cards', () => {
        let game = games[user.tableId];
        nextPlayer(user.tableId);
        for (let i = 1; i < 5; i++) {
            let p = 'player' + i;
            io.to(game[p].userId).emit('game_info', game);
        }
    });
    
    //when a player slaps the pile
    socket.on('slap', () => {
        let game = games[user.tableId];
        let player = user.playerNumber;
        let cards = game.pile;
        //let isSlapped = false;
        let time = new Date().getTime();
        
        if (time > game.pauseTill) {
            if (time > game[player].pauseTill) {
                //check if is legit slap
                let isSlapped = isSlap(cards, game);
                //if the player has won the round
                if (game.roundOver && player === game.facePlayer && !isSlapped[0]) {
                    for (let i = 1; i < 5; i++) {
                        let p = 'player' + i;
                        if (game[p] !== null) {
                            //send slap to every other player
                            if (game[p].userId !== userId)
                                io.to(game[p].userId).emit('slap');//maybe remove slap??
                            io.to(game[p].userId).emit('chat', `<p>${user.name} won the pile.</p>`);
                        }
                    }
                    takePile(user.tableId, player);
                } else {
                    //legit slap
                    if (isSlapped[0]) {
                        game.slaps++;
                        game[player + 'slaps'].slaps++;
                        for (let i = 1; i < 5; i++) {
                            let p = 'player' + i;
                            if (game[p] !== null) {
                                //send slap to every other player
                                if (game[p].userId !== userId)
                                    io.to(game[p].userId).emit('slap');
                                io.to(game[p].userId).emit('chat', `<p>${user.name} slapped: ${isSlapped[1]}</p>`);
                            }
                        }
                        takePile(user.tableId, player);
                    } else {
                        //illegitimate slap
                        if (game[player].cards.length !== 0) {
                            let c = game[player].cards[0];
                            //take their top card and put it at the bottom of the deck
                            game.pile.splice(0, 0, game[player].cards.splice(0, 1)[0]);
                            //if the user is out of cards. next player
                            if (game[player].cards.length === 0)
                                nextPlayer(user.tableId);
                            for (let i = 1; i < 5; i++) {
                                let p = 'player' + i;
                                if (game[p] !== null) {
                                    if (game[p].userId !== userId)
                                        io.to(game[p].userId).emit('slap');
                                    if (c[1] !== 'joker')
                                        io.to(game[p].userId).emit('chat', `<p>${user.name} slapped and added ${mapToWord(map(c[0]))} of ${c[1]} to the bottom</p>`);
                                    else io.to(game[p].userId).emit('chat', `<p>${user.name} slapped and added a joker to the bottom</p>`);
                                }
                            }
                            for (let i = 1; i < 5; i++) {
                                let p = 'player' + i;
                                if (game[p] !== null)
                                    io.to(game[p].userId).emit('game_info', game);
                            }
                        } else {
                            game[player].pauseTill = time + game.timeout;
                            io.to(game[player].userId).emit('timeout', game.timeout);
                        }
                    }
                }
                game.pauseTill = time + 999;
            }
        }
        //check if game is over (3 players have no cards)
        let counter = 0;
        let players = 0;
        for (let i = 1; i < 5; i++) {
            let p = 'player' + i;
            if (game[p] !== null) {
                players++;
                if (game[p].cards.length === 0)
                    counter++;
            }
        }
        if (counter === players - 1)
            endGame(user.tableId);
    });
    
    //this socket is used to keep the table lobby form in sync with other players
    socket.on('rules', rules => {
        let table;
        //get the table:
        //table = tables[id, where tables.id.somePlayer.userId = userId]
        for (let id in tables)
            for (let i = 1; i < 5; i++) {
                let player = 'player' + i;
                if (tables[id][player] !== null)
                    if (tables[id][player].userId === userId)
                        table = tables[id];
            }
        //get values from form into table
        table.sandwich = rules[0];
        table.run = rules[1];
        table.bottomTop = rules[2];
        table.jokers = rules[3];
        table.flush = rules[4];
        table.timeout = rules[5];
        table.double = rules[6];
        table.sumten = rules[7];
        table.quit = rules[8];
        //send table back to players
        for (let i = 1; i < 5; i++) {
            let player = 'player' + i;
            if (table[player] !== null)
                io.to(table[player].userId).emit('rules', table);
        }
    });
    
    socket.on('rating_search', name => {
        
        if (name in ratingMap) {
            let order = Object.keys(ratingMap).sort(((a, b) => ratingMap[a] < ratingMap[b]));
            
            //remove players who have not played!
            for (let i = order.length - 1; i >= 0; i--)
                if (gamesCountMap[order[i]] === 0)
                    order.splice(i, 1);
            
            
            let profile = `
                <p>Rank: ${order.indexOf(name) + 1} Rating: ${ratingMap[name]}</p>
                <p>Games: ${gamesCountMap[name]} Slaps: ${slapsMap[name]}</p>
            `;
            io.to(userId).emit('rating_search', profile);
        } else io.to(userId).emit('rating_search', 'user does not exist');
    });
    
});

const takePile = (tableId, player) => {
    let game = games[tableId];
    //push all pile cards to player cards
    for (let i = 0; i < game.pile.length; i++) {
        game[player].cards.push(game.pile[i]);
    }
    //empty the pile
    game.pile = [];
    //turn everyone off
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        if (game[p] !== null)
            game[p].ready = false;
    }
    //give turn to player who won
    game[player].ready = true;
    game.roundOver = false;
    game.facePlayer = 'none';
    game.triesLeft = 0;
    //clear pile and send game_info
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        if (game[p] !== null) {
            io.to(game[p].userId).emit('game_info', game);
        }
    }
};

const newGame = tableId =>  {
    //move the table from tables to games
    games[tableId] = tables[tableId];
    let game = games[tableId];
    delete tables[tableId];
    //update lobby
    for (let player in lobby)
        io.to(player).emit('lobby', tables);
    game.pile = [];
    game.facePlayer = 'none';
    game.triesLeft = 0;
    game.roundOver = false;
    game.pauseTill = 0;
    game.slaps = 0;
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        if (game[p] !== null) {
            game[p + 'slaps'] = new slaps(game[p].name);
        }
    }
    
    if (game.timeout === 'off')
        game.timeout = 0;
    else if (game.timeout === 'two')
        game.timeout = 1000 * 60 * 2;
    else if (game.timeout === 'five')
        game.timeout = 1000 * 60 * 5;
    else if (game.timeout === 'forever')
        game.timeout = 13370000; //a lot..
    //setup game for clients
    io.sockets.emit('chat',`<p>starting game with:</p>`);
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        if (game[p] !== null) {
            game[p].ready = false;
            game[p].cards = [];
            io.to(game[p].userId).emit('setup_game');
    
            
    
            client.query(`SELECT * FROM users WHERE name = '${game[p].name}';`).on('row', row => {
                game[`player${i}slaps`].rating = row.rating;
                io.sockets.emit('chat',`<p>-${game[p].name}- rating: ${game[`player${i}slaps`].rating}</p>`);
            });
            
            
        }
    }
    
    //make a deck
    let gameDeck = deck(game.jokers);
    //deal it out
    while (gameDeck.length > 0) {
        for (let i = 1; i < 5; i++) {
            let p = 'player' + i;
            if (gameDeck.length >0 && game[p] !== null) {
                game[p].ready = false;
                game[p].cards.push(gameDeck[0]);
                gameDeck.splice(0, 1);
            }
        }
    }
    //add playerNumber property to users
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        if (game[p] !== null)
            userMap[game[p].userId].playerNumber = p;
    }
    //give a random player the first turn
    let legit = false;
    while (!legit) {
        let turn = 'player' + (Math.floor(Math.random() * 4) + 1);
        if (game[turn] !== null) {
            game[turn].ready = true;
            legit = true;
        }
    }
    //get a count of players (for end game text)
    let count = 0;
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        if (game[p] !== null)
            count++;
    }
    game.startCount = count;
    
    //start game
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        if (game[p] !== null)
            io.to(game[p].userId).emit('game_info', game);
    }
};

const deck = (jokers) => {
    let deckReturn = [];
    const deckValues = [
        [1,2,3,4,5,6,7,8,9,10,13,14,15],
        ["clubs", "spades", "hearts", "diamonds"]
    ];
    for (let v = 0; v < deckValues[0].length; v++)
        for (let s = 0; s < deckValues[1].length; s++) {
            deckReturn.push([deckValues[0][v], deckValues[1][s]]);
        }
    if (jokers === 'on') {
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
        deckReturn.push([11, 'joker']);
    }
    shuffle(deckReturn);
    return deckReturn;
};
const shuffle = array => {
    for (let i = array.length; i; i--) {
        let j = Math.floor(Math.random() * i);
        [array[i - 1], array[j]] = [array[j], array[i - 1]];
    }
};

const endGame = tableId => {
    console.log('ending game');
    let game = games[tableId];
    //turn off timeouts
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        if (game[p] !== null)
            io.to(game[p].userId).emit('timeout_over');
    }
    //find winner
    let winner;
    let cardCount = 0;
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        if (game[p] !== null)
            if (game[p].cards.length > cardCount) {
                cardCount = game[p].cards.length;
                winner = p;
            }
    }
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
        if (game[p] !== null) {
            let id = game[p].userId;
            userMap[id].tableId = 'none';
            lobby[id] = game[p].name;
        }
    }
    calcRatings(game, winner);
    delete games[tableId];
    for (let key in lobby) io.to(key).emit('lobby', tables );
    
    
};

const nextPlayer = tableId => {
    let game = games[tableId];
    let next;
    let current;
    //get the current player
    for (let i = 1; i < 5; i++) {
        let p =  'player' +  i;
        if (game[p] !== null)
            if (game[p].ready)
                current = i;
    }
    //flip current player's ready boolean
    game['player' + current].ready = false;
    //find the next non-null player
    let legit = false;
    next = current + 1;
    while (!legit) {
        if (next === 5)
            next = 1;
        let p = 'player' + next;
        if (game[p] !== null)
            if (game[p].cards.length) {
                game[p].ready = true;
                legit = true;
            }
        next++;
    }
};

const isSlap = (cards, game) => {
    let isSlapped = false;
    let message = 'illegal slap!';
    if (cards.length > 0)
        if (cards[cards.length - 1][1] === 'joker') {
            isSlapped = true;
            message = 'joker';
        }
    if (game.run === 'four')
        if (cards.length > 3) {
            let l = cards.length;
            if (is4Run(cards[l - 1][0], cards[l - 2][0], cards[l - 3][0], cards[l - 4][0])) {
                isSlapped = true;
                message = `run ${mapToWord(map(cards[l - 1][0]))} to ${mapToWord(map(cards[l - 4][0]))}`;
            }
        }
    if (game.run === 'three')
        if (cards.length > 2) {
            let l = cards.length;
            if (is3Run(cards[l - 1][0], cards[l - 2][0], cards[l - 3][0])) {
                isSlapped = true;
                message = `run ${mapToWord(map(cards[l - 1][0]))} to ${mapToWord(map(cards[l - 3][0]))}`;
            }
        }
    if (game.run === 'two')
        if (cards.length > 1) {
            let l = cards.length;
            if (is2Run(cards[l - 1][0], cards[l - 2][0])) {
                isSlapped = true;
                message = `run ${mapToWord(map(cards[l - 1][0]))} to ${mapToWord(map(cards[l - 2][0]))}`;
            }
        }
    if (cards.length > 1) {
        if (game.bottomTop === 'on')
            if (cards[0][0] === cards[cards.length - 1][0]) {
                isSlapped = true;
                message = `${mapToWord(map(cards[0][0]))} (bottom = top)`;
            }
        if (game.double === 'on')
            if (cards[cards.length - 1][0] === cards[cards.length - 2][0]) {
                isSlapped = true;
                message = `double ${mapToWord(map(cards[cards.length - 1][0]))}s`;
            }
        if (game.sumten === 'on')
            if (cards[cards.length - 1][0] + cards[cards.length - 2][0] === 10) {
                isSlapped = true;
                message = `${mapToWord(map(cards[cards.length - 1][0]))} + ${mapToWord(map(cards[cards.length - 2][0]))} = ten`;
            }
    }
    if (game.sandwich === 'on')
        if (cards.length > 2) {
            if (game.double === 'on')
                if (cards[cards.length - 1][0] === cards[cards.length - 3][0]) {
                    isSlapped = true;
                    message = `sandwiched double ${mapToWord(map(cards[cards.length - 3][0]))}s`;
                }
            if (game.sumten === 'on')
                if (cards[cards.length - 1][0] + cards[cards.length - 3][0] === 10) {
                    isSlapped = true;
                    message = `${mapToWord(map(cards[cards.length - 1][0]))} + ${mapToWord(map(cards[cards.length - 3][0]))} = ten`;
                }
        }
        
    if(game.flush === 'two') {
        if (cards.length > 1)
            if (cards[cards.length - 1][1] === cards[cards.length - 2][1]) {
                isSlapped = true;
                message = `${cards[cards.length - 1][1]} flush`;
            }
    }
    if(game.flush === 'three') {
        if (cards.length > 2)
            if (cards[cards.length - 1][1] === cards[cards.length - 2][1] &&
                cards[cards.length - 1][1] === cards[cards.length - 3][1]) {
                isSlapped = true;
                message = `${cards[cards.length - 1][1]} flush`;
            }
    }
    if(game.flush === 'four') {
        if (cards.length > 3)
            if (cards[cards.length - 1][1] === cards[cards.length - 2][1] &&
                cards[cards.length - 1][1] === cards[cards.length - 3][1] &&
                cards[cards.length - 1][1] === cards[cards.length - 4][1]) {
                isSlapped = true;
                message = `${cards[cards.length - 1][1]} flush`;
            }
    }
    
    return [isSlapped, message];
};

const removeFromGame = (tableId, player) => {
    let game = games[tableId];
    let cards = game[player].cards;
    
    if (game[player].ready)
        nextPlayer(tableId);
    
    game[player] = null;
    console.log(cards);
    
    if (game.quit !== 'end') {
    
        if (game.quit !== 'gone') {
    
            while (cards.length !== 0) {
        
                for (let i = 1; i < 5; i++) {
            
                    let p = 'player' + i;
            
                    console.log("this card is: " + cards[0]);
            
                    if (game.quit === 'distribute')
                        if (cards.length !== 0)
                            if (game[p] !== null) {
                                game[p].cards.push(cards[0]);
                                cards.splice(0, 1);
                            }
            
                    if (game.quit === 'bottom')
                        if (cards.length !== 0) {
                            game.pile.splice(0, 0, cards[0]);
                            cards.splice(0, 1);
                        }
                }
        
            }
            for (let i = 1; i < 5; i++) {
                let p = 'player' + i;
                if (game[p] !== null) {
                    console.log(game[p].name);
                    console.dir(game[p].cards);
                }
            }
            console.dir(game)
        }
        
    } else endGame(tableId);
    
};

const is4Run = (a,b,c,d) => {
    let bool = false;
    a = map(a); b = map(b); c = map(c); d = map(d);
    if (a === b+1 && b === c+1 && c === d+1) bool = true;
    if (d === c+1 && c === b+1 && b === a+1) bool = true;
    return bool;
};

const is3Run = (a,b,c) => {
    let bool = false;
    a = map(a); b = map(b); c = map(c);
    if (a === b+1 && b === c+1) bool = true;
    if (c === b+1 && b === a+1) bool = true;
    return bool;
};

const is2Run = (a,b) => {
    let bool = false;
    a = map(a); b = map(b);
    if (a === b+1) bool = true;
    if (b === a+1) bool = true;
    return bool;
};

const map = a => {
    if (a === 13) a = 11;
    if (a === 14) a = 12;
    if (a === 15) a = 13;
    return a;
};
const mapToWord = a => {
    if (a === 1) a = 'ace';
    if (a === 2) a = 'two';
    if (a === 3) a = 'three';
    if (a === 4) a = 'four';
    if (a === 5) a = 'five';
    if (a === 6) a = 'six';
    if (a === 7) a = 'seven';
    if (a === 8) a = 'eight';
    if (a === 9) a = 'nine';
    if (a === 10) a = 'ten';
    if (a === 11) a = 'jack';
    if (a === 12) a = 'queen';
    if (a === 13) a = 'king';
    return a;
};

const htmlRules = gameId => {
    let game = games[gameId];
    return `
        <p><b>slap conditions:</b></p>
        <p>Doubles: ${game.double}</p>
        <p>Sandwiches: ${game.sandwich}</p>
        <p>Adds to ten: ${game.sumten}</p>
        <p>Bottom = top: ${game.bottomTop}</p>
        <p>Runs: ${game.run}</p>
        <p>Flushes: ${game.flush}</p>
        <p><b>Other conditions:</b></p>
        <p>Jokers: ${game.jokers}</p>
        <p>Timeout: ${game.timeout} (milli seconds im too lazy to convert this for you)</p>
        <p>Quiters: ${game.quit}</p>
    `;
};

const calcRatings = (game, winner) => {
    //get players from start
    let players = [];
    let expectedDivisor = 0;
    for (let i = 1; i < 5; i++) {
        if (`player${i}slaps` in game) {
            players.push(i);
        }
    }
    //maybe one day i will understand why for (i in players) doesn't work ....
    for (let x = 0; x < players.length; x++) {
        let i = players[x];
        console.log(`player${i}slaps`);
        game['R' + i] = Math.pow( 10, game[`player${i}slaps`].rating/400 );
        expectedDivisor += game['R' + i];
        console.log(game['R' + i]);
    }
    expectedDivisor = expectedDivisor/(players.length/2);
    io.sockets.emit('chat', `Congratulations ${game[winner].name} for winning a game with ${game.slaps} slaps`);
    for (let x = 0; x < players.length; x++) {
        let i = players[x];
        let score;
        if (game.slaps > 0 )
            score = game[`player${i}slaps`].slaps/game.slaps;
        else score = 1/players.length; //gives "tie" if no slaps happen
        //adjust score for # of players
        score = score * players.length / 2;
        let expected = game['R' + i]/expectedDivisor;
        let rating = game[`player${i}slaps`].rating + K * (score - expected);
        io.sockets.emit('chat', `<p>${game[`player${i}slaps`].name} got ${game[`player${i}slaps`].slaps} slaps</p>
<p>old rating: ${game[`player${i}slaps`].rating}  new rating: ${rating.toFixed(0)}</p>`);
        gamesCountMap[game[`player${i}slaps`].name] ++;
        slapsMap[game[`player${i}slaps`].name] += game[`player${i}slaps`].slaps;
        client.query(
            `UPDATE users SET rating = ${rating.toFixed(0)}, games = ${gamesCountMap[game[`player${i}slaps`].name]},
 slaps = ${slapsMap[game[`player${i}slaps`].name]} WHERE name = '${game[`player${i}slaps`].name}';`);
        //update ratingMap
        ratingMap[game[`player${i}slaps`].name] = rating.toFixed(0);
    }
};

const topFive = () => {
    let order = Object.keys(ratingMap).sort(((a, b) => ratingMap[a] < ratingMap[b]));
    //remove players who have not played!
    for (let i = order.length - 1; i >= 0; i--)
        if (gamesCountMap[order[i]] === 0)
            order.splice(i, 1);
    let table = `
        <table class="table">
            <tr>
                <td>rank</td>
                <td>name</td>
                <td>rating</td>
                <td>games</td>
                <td>slaps</td>
            </tr>
    `;
    let five = 5;
    if (order.length < 5)
        five = order.length;
    for (let i = 0; i < five; i++) {
        table += `
            <tr>
                <td>${i+1}</td>
                <td>${order[i]}</td>
                <td>${ratingMap[order[i]]}</td>
                <td>${gamesCountMap[order[i]]}</td>
                <td>${slapsMap[order[i]]}</td>
            </tr>
        `;
    }
    table += '</table>';
    return table;
    
};

/*
 -add DB
 -form doesn't sync after players are put back in table lobby
 -form should give options:
 * add 0/1/2/3 to bottom on incorrect slaps
 * triples = off/win/lose
 * suit triples on/off
 */