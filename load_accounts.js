var config        = require('./config/config'),
    mongoose      = require('mongoose'),
    watson        = require('watson-developer-cloud'),
    fs            = require('fs'),
    TwitterHelper = require('./app/util/twitter-helper'),
    async         = require('async');

// Load Mongoose Schemas
require('./app/models/profile');
require('./app/models/user');

// Mongoose by default sets the auto_reconnect option to true.
// Recommended a 30 second connection timeout because it allows for
// plenty of time in most operating environments.
var connect = function () {
    console.log('connect-to-mongodb');
    var options = {
        server: { socketOptions: { keepAlive: 1, connectTimeoutMS: 30000 } },
        replset: { socketOptions: { keepAlive: 1, connectTimeoutMS : 30000 } }
    };
    mongoose.connect(config.mongodb, options);
};
connect();

mongoose.connection.on('error', console.log.bind(console, 'mongoose-connection-error:'));
mongoose.connection.on('open', console.log.bind(console,'connect-to-mongodb'));
mongoose.connection.on('disconnected', connect);

// Create the twitter helper
var twit = new TwitterHelper(config.twitter);

// Create the personality insights service
var personality_insights = new watson.personality_insights(config.personality_insights);

var Q        = require('q'),
    Profile  = mongoose.model('Profile'),
    User     = mongoose.model('User'),
    accounts = require('./account_data/accounts.json');

function loadAccount(account, next) {
    var username = account.id;
    //console.log(username);
    // Check if the user exists
    Profile.findOne({username:username.replace('@','').replace(' ','').toLowerCase()}, function(err,profile) {
        if (err) {
            console.log({id:username, error: err});
            return next();
        }
        else if (profile) {
            //console.log('User is already in the database');
            return next();
        }
        else {
            console.log(account.id + "," + account.);
            return next();
            setTimeout(function() {
            // Check if the user is verified, >10k followers, and >1k tweets
            var showUser = Q.denodeify(twit.showUser.bind(twit));
            showUser(username)
                .then(function(user) {
                    if (user.tweets < 100 ) {
                        console.log({id:username, error: 'User does not have enough tweets'});
                        return next();
                    }
                    else if (user.protected) {
                        console.log({id:username, error: 'User is protected and cannot be added'});
                        return next();
                    }
                    else {
                        // Get the tweets, profile and add him to the database
                        var getTweets = Q.denodeify(twit.getTweets.bind(twit));
                        return getTweets(username)
                            .then(function(tweets) {
                                console.log(username, 'has', tweets.length, 'tweets');
                                var getProfile = Q.denodeify(personality_insights.profile.bind(personality_insights));
                                return getProfile({contentItems:tweets})
                                    .then(function(profile) {
                                        if (!profile)
                                            return;
                                        console.log(username, 'analyze with personality insights');

                                        console.log(username, 'added to the database');
                                        user.profile = JSON.stringify(profile);
                                        var saveProfileInDB = Q.denodeify(Profile.createOrUpdate.bind(Profile));
                                        return saveProfileInDB(user);
                                    });
                            })
                            .then(function(dbUser) {
                                if (!dbUser) {
                                    console.log({id:username, error: 'Error creating user in db'});
                                    return next();
                                }

                                return next();
                            });
                    }
                })
                .catch(function (error) {
                    console.log('catch():', error);
                    var err,
                        status = 500;
                    if (error.statusCode === 429) {
                        console.log({id:username, error: 'Twitter rate limit exceeded, come back in 15 minutes.'});
                        return next('Twitter rate limit exceeded, come back in 15 minutes.');
                    }
                    else if (error.statusCode === 503) {
                        console.log({
                            id: username,
                            error: 'The Twitter servers are overloaded with requests. Try again later.'
                        });
                        return next('The Twitter servers are overloaded with requests. Try again later.');
                    }
                    else if (error.statusCode === 404) {
                        err = 'Sorry, @' + username + ' does not exist.';
                        status = 404;
                    } else {
                        err = 'Sorry, there was an error. Please try again later.';
                    }

                    console.log({id:username, error: err});
                    return next();
                });
            }, 15000);
        }
    });
}

async.eachSeries(accounts, loadAccount, function(err) {
    console.log('Import complete');
    process.exit(0);
})
