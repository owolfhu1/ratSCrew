/**
 *  Created by Orion Wolf_Hubbard on 6/4/2017.
 */

let app = require('express')();
let http = require('http').Server(app);
let io = require('socket.io')(http);
let port = process.env.PORT || 3000;

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html') });
http.listen(port,() => { console.log('listening on *:' + port) });

let userMap = {};
let lobby = {};
let passwordMap = {};
let tables = {};
let games = {};

let newTable = function () {
    this.player1 = null;
    this.player2 = null;
    this.player3 = null;
    this.player4 = null;
};

let newPlayer = function (name, userId) {
    this.name = name;
    this.userId = userId;
    this.ready = 'not ready';
    this.cards = null;
};

let newUser = function (userId) {
    this.name = 'no input';
    this.tableId = 'none';
    this.userId = userId;
};

io.on('connection', socket => {
    let userId = socket.id;
    io.to(userId).emit('setup_login');
    userMap[userId] = new newUser(userId);
    
    let user = userMap[userId];
    
    
    
    
    //TODO   $$$$$$     LOGIN
    
    socket.on('login', loginInfo => {
        let NAME = 0, PASS = 1;
        //attempt to log in
        if (loginInfo[NAME] in passwordMap) {
            //try password if name exists
            if (passwordMap[loginInfo[NAME]] === loginInfo[PASS]) {
                console.log(`${loginInfo[NAME]} logging in`);
                //update name in userMap, you are logged in
                userMap[userId].name = loginInfo[NAME];
            } else {
                //resend 'login_setup' on fail TODO make this better...
                io.to(userId).emit('login_setup');
            }
        } else {
            //if username doesn't already exist add it and login
            console.log(`${loginInfo[NAME]} logging in`);
            passwordMap[loginInfo[NAME]] = loginInfo[PASS];
            userMap[userId].name = loginInfo[NAME];
        }
        //if the users name has been changed, they are logged in, emit 'lobby_setup'
        if (userMap[userId].name !== 'no input') {
            //add player to lobby
            lobby[userId] = userMap[userId].name;
            //update lobby for every player in lobby
            for (let key in lobby) io.to(key).emit('lobby', tables );
        }
    });
    
    
    
    
    //TODO   %%%%%%%%%%%%%%% DISCONNECT
    
    socket.on('disconnect', () => {
        console.log(`user ${userMap[userId].name} logging off`);
        
        //if the user has joined a table, remove them
        if(user.tableId !== 'none'){
            //check if user is at a table and not a game
            if (user.tableId in tables) {
                let player;
                let table = tables[user.tableId];
                
                //pick the player out of the table
                for (let key in table)
                    if (table[key] !== null)
                        if (table[key].userId === userId)
                            player = key;
    
                //remove them from the table object
                table[player] = null;
                
                //check if anyone is still at the table
                let empty = true;
                for (let key in table) if (table[key] !== null) empty = false;
                
                //if its empty, delete it
                if (empty) {
                    delete tables[user.tableId];
                } else {
                    //else send table emit to recipients
                    for (let key in table)
                        if (table[key] !== null)
                            io.to(table[key].userId).emit('table', [table, key]);
                }
                
                //update the lobby
                for (let key in lobby) io.to(key).emit('lobby', tables );
            }
        }
        delete userMap[userId];
    });
  
    
    
    
    //TODO  ################   JOIN_TABLE
    
    socket.on('join_table', tableId => {
        console.log('table button pressed: ' + tableId);
        
        if (tableId === 'new') {
            
            console.log('building new table');
            
            //gen new tableId
            tableId = Math.random().toString(36).substr(2, 5);
            
            //add new table to tables obj and define it ad variable
            tables[tableId] = new newTable();
            let table = tables[tableId];
            
            //add player to table
            user.tableId = tableId;
            table.player1 = new newPlayer(user.name, userId);
        
            //remove user from lobby and update lobby
            delete lobby[userId];
            for (let key in lobby) io.to(key).emit('lobby', tables );
        
            //emit table to players in table
            for (let key in table)
                if (table[key] !== null)
                    io.to(table[key].userId).emit('table', [table, table[key].userId]);
        
        } else {
            let table = tables[tableId];
            let added = false;
        
            //check each player (player1, player2, .. er4)
            for (let i = 1; i < 5; i++) {
                let player = 'player' + i;
                
                //if that player is null
                if (table[player] === null) {
                    
                    //add the player
                    user.tableId = tableId;
                    table[player] = new newPlayer(user.name, userId);
                
                    //flip the boolean
                    added = true;
                
                    //exit the loop
                    i = 420;
    
                    delete lobby[userId];
                }
            }
            
            //the user was added
            if (added) {
                
                // update table for table recipients
                for (let key in table)
                    if (table[key] !== null)
                        io.to(table[key].userId).emit('table', [table, key]);
                
                //remove from lobby and update lobby for lobby recipients
                delete lobby[userId];
                for (let key in lobby) io.to(key).emit('lobby', tables );
            }
            
        }
        
    });
    
    
    
    //TODO      ((((o))))((((o    READY     o))))((((o))))
    
    
    //when player hits ready button at table
    socket.on('ready', player => {
        console.log('****player ' + user.name + ' hit ready button****');
        let table = tables[user.tableId];
        
        //flip player's ready property
        if (table[player].ready === 'not ready')
            table[player].ready = 'ready';
        else table[player].ready = 'not ready';
    
        //update clients in table
        for (let key in table)
            if (table[key] !== null)
            //update the table for each player at the table
                io.to(table[key].userId).emit('table', [table, key]);
        
        //check if all players are ready
        let ready = 0;
        for (let key in table)
            if (table[key] !== null)
                if (table[key].ready === 'ready')
                    ready++;
        if (ready === 4) newGame(user.tableId);
        
    });
    
    
    //TODO    @@@@@@@@@@@@@ PLAY_CARD   &&&&&***((o))
    
    
    socket.on('play_card', () => {
        console.log('player playing card');
        let game = games[user.tableId];
        let player = user.playerNumber;
        let card = game[player].cards[0];
        
        //if someone played a face/ace
        if (game.facePlayer !== 'none') {
            //if player plays a face/ace
            if (card[0] > 10 || card[0] === 1) {
                //change facePlayer and set triesLeft
                game.facePlayer = player;
                if (card[0] === 1) game.triesLeft = 4;
                else if (card[0] === 13) game.triesLeft = 1;
                else if (card[0] === 14) game.triesLeft = 2;
                else if (card[0] === 15) game.triesLeft = 3;
    
    
                //add the card to game pile
                game.pile.push(game[player].cards[0]);
                //remove the card from player cards
                game[user.playerNumber].cards.splice(0,1);
                
                //next player's turn
                nextPlayer(user.tableId);
                
                //update
                for (let player in game)
                    if (game.hasOwnProperty(player))
                        io.to(game[player].userId).emit('game_info', game);
                //if player is out of cards or tries
            } else if (game.triesLeft === 1 || game[player].cards.length === 0) {
                
                
                
                //no-ones turn, wait for player to claim pile or slap
                game[player].ready = false;
                game.roundOver = true;
                //add the card to game pile
                game.pile.push(game[player].cards[0]);/////
                //remove the card from player cards
                game[user.playerNumber].cards.splice(0,1);
                
                //update
                for (let player in game)
                    if (game.hasOwnProperty(player))
                        io.to(game[player].userId).emit('game_info', game);
                
                
                
                
                
            } else { //player goes again
                game.triesLeft--;
                //add the card to game pile
                game.pile.push(game[player].cards[0]);/////
                //remove the card from player cards
                game[user.playerNumber].cards.splice(0,1);
                
                for (let player in game)
                    if (game.hasOwnProperty(player))
                        io.to(game[player].userId).emit('game_info', game);
            }
        } else {
    
            if (card[0] > 10 || card[0] === 1) {
                //change facePlayer and set triesLeft
                game.facePlayer = player;
                if (card[0] === 1) game.triesLeft = 4;
                else if (card[0] === 13) game.triesLeft = 1;
                else if (card[0] === 14) game.triesLeft = 2;
                else if (card[0] === 15) game.triesLeft = 3;
        
        
                //add the card to game pile
                game.pile.push(game[player].cards[0]);/////
                //remove the card from player cards
                game[user.playerNumber].cards.splice(0,1);
        
                //next player's turn
                nextPlayer(user.tableId);
        
                //update
                for (let player in game)
                    if (game.hasOwnProperty(player))
                        io.to(game[player].userId).emit('game_info', game);
                //if player is out of cards or tries
            } else {
    
                //add the card to game pile
                game.pile.push(game[player].cards[0]);/////
                //remove the card from player cards
                game[user.playerNumber].cards.splice(0, 1);
                //change turns
                nextPlayer(user.tableId);
                //emit game to players
                for (let player in game)
                    if (game.hasOwnProperty(player))
                        io.to(game[player].userId).emit('game_info', game);
            }
        }
        console.log(`player ${game[player].name} played ${card} this is the result`);
        console.log(game.pile);
        
    });
    
    
    
    socket.on('no_cards', () => {
        let game = games[user.tableId];
        nextPlayer(user.tableId);
    
        for (let player in game)
            if (game.hasOwnProperty(player))
                io.to(game[player].userId).emit('game_info', game);
        
    });
    
    
    
    //TODO ????$$$$$@@@@@ SSSSLLLLAAAAPPPPPP SLAP!
    
    socket.on('slap', () => {
        let game = games[user.tableId];
        console.log(game.pile);
        let player = user.playerNumber;
        let cards = game.pile;
        console.log(user.name + ' slapped the pile');
        let isSlapped = false;
        
        
        
        if (cards.length > 1) {
            if (cards[cards.length - 1][0] === cards[cards.length - 2][0]) isSlapped = true;
            if (cards[cards.length - 1][0] + cards[cards.length - 2][0] === 10) isSlapped = true;
        }
        if (cards.length > 2) {
            if (cards[cards.length - 1][0] === cards[cards.length - 3][0]) isSlapped = true;
            if (cards[cards.length - 1][0] + cards[cards.length - 3][0] === 10) isSlapped = true;
        }
        
        
        //if the player has won the round
        if (game.roundOver && player === game.facePlayer) {
    
            for (let p in game)
                if (game.hasOwnProperty(p))
                    io.to(game[p].userId).emit('slap', `<h2>${user.name}<br>won the pile!</h2>`);
            
            takePile(user.tableId, player);
        } else {
            if(isSlapped){
                for (let p in game)
                    if (game.hasOwnProperty(p))
                        io.to(game[p].userId).emit('slap', `<h2>${user.name}<br>slapped and took<br>the pile!</h2>`);
                
                takePile(user.tableId, player);
            } else {
                if (game[player].cards.length !== 0) {
                    let c = game[player].cards[0];
                    console.log(`${c[0]} of ${c[1]} bottom piled`);
                    //take their top card and put it at the bottom of the deck
                    game.pile.splice(0, 0, c);
                    console.log(game[player].cards.splice(0, 1));///un-log-this
    
                    //if the user is out of cards. next player
                    if (game[player].cards.length === 0)
                        nextPlayer(user.tableId);
    
                    for (let p in game)
                        if (game.hasOwnProperty(p))
                            io.to(game[p].userId).emit('slap', `
<h2>${user.name}<br>slapped and added <br>${printCard(c)}<br> to bottom</h2>`);
                }///TODO else emit 'time_out' to player here
            }
        }
    });
    
});

const printCard = (card) =>
    `<img src= "http://owolfhu1.x10host.com/Oh_Hell_solo/img/card${card[1]}${card[0]}.png" style="height: 35%;">`;


const takePile = (tableId, player) => {
    let game = games[tableId];
    console.log(game.pile);
    
    
    //push all pile cards to player cards
    for (let card in game.pile) {
        console.log('pushing ' + card);
        game[player].cards.push(card);
    }
    
    
    
    //empty the pile
    game.pile = [];
    
    //turn everyone off
    for (let p in game)
        if (game.hasOwnProperty(p))
            if (p !== 'pile')
                game[p].ready = false;
    
    
    
    //give turn to player who won
    game[player].ready = true;
    game.roundOver = false;
    game.facePlayer = 'none';
    game.triesLeft = 0;
    
    
    
    for (let i = 1; i < 5; i++) {
        let p = 'player' + i;
    
        console.log('-=> clear_game -=> game_info -=> ' + game[p].userId);
        
        io.to(game[p].userId).emit('clear_game');
        io.to(game[p].userId).emit('game_info', game);
       
    }
    
};



//todo ##########$$$$$$$$%%%% CONST NEWGAME() ==>>> GAME

const newGame = tableId =>  {
    //move the table from tables to games
    games[tableId] = tables[tableId];
    delete tables[tableId];
    
    //update lobby
    for (let player in lobby)
        io.to(player).emit('lobby', tables);
    
    let game = games[tableId];
    
    //setup game for clients
    for (let player in game) {
        game[player].ready = false;
        game[player].cards = [];
        io.to(game[player].userId).emit('setup_game');
    }
    
    //make a deck
    let gameDeck = deck();
    
    //deal it out
    for (let player in game) {
        for (let i = 0; i < 13; i++) {
            game[player].cards.push(gameDeck[0]);
            gameDeck.splice(0,1);
        }
    }
    
    //add playerNumber property to users
    for (let player in game){
        userMap[game[player].userId].playerNumber = player;
    }
    
    
    //add properties to game
    game.pile = [];
    game.facePlayer = 'none';
    game.triesLeft = 0;
    game.roundOver = false;
    //TODO
    //give a random player the first turn
    let turn = 'player' + (Math.floor(Math.random() * 4) + 1);
    game[turn].ready = true;
    
    //start game
    for (let player in game)
        if (game.hasOwnProperty(player))
            io.to(game[player].userId).emit('game_info', game);
};



//tOdO   BUUUILD THE DECK  = () ==>> [DECK OF CARDS]

const deck = () => {
    let deckReturn = [];
    
    const deckValues = [
        [1,2,3,4,5,6,7,8,9,10,13,14,15],
        ["clubs", "spades", "hearts", "diamonds"]
    ];
    
    for (let v = 0; v < deckValues[0].length; v++) {
        for (let s = 0; s < deckValues[1].length; s++) {
            deckReturn.push([deckValues[0][v], deckValues[1][s]]);
        }
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

const nextPlayer = tableId => {
    let game = games[tableId];
    let next;
    
    if (game.player1.ready) {
        game.player1.ready = false;
        game.player2.ready = true;
        next = 'player2';
    } else if (game.player2.ready) {
        game.player2.ready = false;
        game.player3.ready = true;
        next = 'player3';
    } else if (game.player3.ready) {
        game.player3.ready = false;
        game.player4.ready = true;
        next = 'player4';
    } else if (game.player4.ready) {
        game.player4.ready = false;
        game.player1.ready = true;
        next = 'player1';
    }
    
    //if the player who's turn got turned on has no cards, next player again
    if (game[next].cards.length === 0) nextPlayer(tableId);
    
};



/*TODO:
        -why is 'ready: false' being pushed into the pile when it is won

*/

