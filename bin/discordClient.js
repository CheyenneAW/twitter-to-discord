'use strict';

const debug = require('debug')('app:discordClient');
const Discord = require('discord.js');
const rimraf = require('rimraf');
const path = require('path');
const commandHandler = require('./discordCommandHandler');
const FeedsModel = require('./models/feeds');
const TweetsModel = require('./models/tweets');
const utils = require('./utils');

debug('Loading discordClient.js');

const client = new Discord.Client({
  disableEveryone: true,
  disabledEvents: [
    'TYPING_START',
  ],
});

// Discord has disconnected
client.on('disconnect', () => {
  console.warn('discord: disconnected');
});

// Discord general warning
client.on('warn', info => {
  console.warn('discord: warning', info);
});

// Discord is reconnecting
client.on('reconnecting', () => {
  console.info('discord: reconnecting');
});

// Discord has resumed
client.on('resumed', replayed => {
  console.info(`discord: resumed, replayed ${replayed} item(s)`);
});

// Discord has erred
client.on('error', err => {
  console.error('discord: error:', err ? err.stack : '');
});

client.on('ready', () => {
  console.info(`discord: connection success: connected as '${client.user.username}'`);
  console.log(`discord: command prefix: ${process.env.DISCORD_CMD_PREFIX}`);
});

client.on('message', msg => {
  // Don't listen to other bots
  if (msg.author.bot) return;
  // Exit if the message does not start with the prefix set
  if (!msg.content.startsWith(process.env.DISCORD_CMD_PREFIX)) return;
  // Exit if the author of the message is not the bot's owner or the guild's owner
  if (msg.author.id !== process.env.DISCORD_BOT_OWNER_ID
    && msg.author.id !== msg.guild.owner.id) return;
  // Split message into an array on any number of spaces
  msg.params = msg.content.split(/ +/g).map(x => x.toLowerCase()); // eslint-disable-line no-param-reassign
  // Pull first index and remove prefix
  msg.cmd = msg.params.shift() // eslint-disable-line no-param-reassign
    .slice(process.env.DISCORD_CMD_PREFIX.length).toLowerCase();
  // Exit if no command was given (prefix only)
  if (!msg.cmd) return;
  // We only want to focus on 'twitter' commands
  if (msg.cmd !== 'twitter') return;
  if (msg.channel.type === 'dm') {
    console.log(`[DM] <${msg.author.tag}>: ${msg.content}`);
  } else {
    console.log(`[${msg.guild.name}] (#${msg.channel.name}) <${msg.author.tag}>: ${msg.content}`);
  }
  msg.prefix = process.env.DISCORD_CMD_PREFIX; // eslint-disable-line no-param-reassign
  debug(msg.prefix, msg.cmd, msg.params);
  commandHandler(msg);
});

module.exports = {
  connect: () => {
    console.log('Attempting to connect to Discord...');
    client.login(process.env.DISCORD_BOT_TOKEN)
      .catch(err => {
        console.error('discord: login error');
        if (err && err.message) console.error(err.message);
        process.exit(1);
      });
  },

  send: (tweet, str, files) => {
    // Get the record for the current feed
    FeedsModel.findOne({ twitter_id: tweet.user.id_str })
      .then(data => {
        // Get channels that exist and we have send message permissions in
        // Mapped into an array of promises
        const channels = data.channels
          .map(c => client.channels.get(c.channel_id))
          .filter(c => c && c.permissionsFor(client.user).has('SEND_MESSAGES'))
          .map(c => channelSend(c, str, files));
        // Send to Discord channels
        utils.promiseSome(channels)
          .then(promiseResults => {
            debug(promiseResults);
            const entry = new TweetsModel({
              tweet_id: tweet.id_str,
              messages: promiseResults,
            });
            debug('saving discord message ids to database');
            entry.save()
              .then(() => {
                debug('save to database completed ok');
              })
              .catch(console.error);
            // Remove the temp directory we made for converting gifs if it exists
            debug('removing temp tweet directory');
            rimraf(path.join(process.env.TEMP, `tweet-${tweet.id_str}`), err =>  {
              debug('removal of temp tweet directory completed: Error:', err);
            });
          })
          .catch(console.error);
      })
      .catch(console.error);
  },
};

function channelSend(channel, str, files) {
  return new Promise((resolve, reject) => {
    channel.send(str, { files })
      .then(message => resolve({ channel_id: channel.id, message_id: message.id }))
      .catch(reject);
  });
}
