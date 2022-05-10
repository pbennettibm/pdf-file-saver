const config = require('./config.json');
const markAsRead =
  config.imapOptions && config.imapOptions.markAsRead
    ? config.imapOptions.markAsRead
    : false;

const fs = require('fs');
const { Base64Decode } = require('base64-stream');

const Imap = require('imap');
const imap = new Imap(config.imap);

const logger = require('simple-node-logger').createSimpleLogger(
  config.logs?.simpleNodeLogger || {
    logFilePath: 'mail-downloader.log',
    timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
  }
);

logger.setLevel(config.logs?.level || 'debug');

function formatFilename(filename, emailFrom, emailDate) {
  let name = filename;

  if (config.downloads) {
    if (config.downloads.filenameFormat) {
      name = config.downloads.filenameFormat;
      name = name.replace(
        '$FROM',
        emailFrom.replace(/.*</i, '').replace('>', '').replace(/@.*/i, '')
      );
      name = name.replace('$DATE', new Date(emailDate).getTime());
      name = name.replace('$FILENAME', filename);
    }

    if (config.downloads.directory)
      name = `${config.downloads.directory}/${name}`;
  }

  return name;
}

function findAttachmentParts(struct, attachments) {
  attachments = attachments || [];

  for (let i = 0, len = struct.length, r; i < len; ++i) {
    if (Array.isArray(struct[i])) {
      findAttachmentParts(struct[i], attachments);
    } else {
      if (
        struct[i].disposition &&
        ['inline', 'attachment'].indexOf(
          struct[i].disposition.type.toLowerCase()
        ) > -1
      ) {
        attachments.push(struct[i]);
      }
    }
  }
  return attachments;
}

function buildAttMessageFunction(attachment, emailFrom, emailDate) {
  const filename = attachment.params.name;
  const encoding = attachment.encoding;

  return function (msg, seqno) {
    const prefix = '(#' + seqno + ') ';
    msg.on('body', function (stream, info) {
      logger.debug(
        prefix + 'Streaming this attachment to file',
        filename,
        info
      );
      const writeStream = fs.createWriteStream(
        formatFilename(filename, emailFrom, emailDate)
      );
      writeStream.on('finish', function () {
        logger.debug(prefix + 'Done writing to file %s', filename);
      });

      if (encoding.toLowerCase() === 'base64') {
        stream.pipe(new Base64Decode()).pipe(writeStream);
      } else {
        stream.pipe(writeStream);
      }
    });

    msg.once('end', function () {
      logger.debug(prefix + 'Finished attachment %s', filename);
      logger.info(`PDF attachment downloaded: ${filename}`);
    });
  };
}

imap.once('ready', function () {
  logger.info('Connected');
  imap.openBox('INBOX', !markAsRead, function (err, box) {
    if (err) throw err;

    imap.search(['UNSEEN'], function (err, results) {
      if (err) throw err;

      if (!results.length) {
        logger.info('No new emails found');
        imap.end();
      } else {
        logger.info(`Found ${results.length} unread emails`);
        const f = imap.fetch(results, {
          bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
          struct: true,
          markSeen: markAsRead,
        });

        f.on('message', function (msg, seqno) {
          logger.debug('Message #%d', seqno);
          const prefix = '(#' + seqno + ') ';
          let emailDate;
          let emailFrom;

          msg.on('body', function (stream, info) {
            let buffer = '';
            stream.on('data', function (chunk) {
              buffer += chunk.toString('utf8');
            });
            stream.once('end', function () {
              const parsedHeader = Imap.parseHeader(buffer);
              logger.debug(prefix + 'Parsed header: %s', parsedHeader);
              emailFrom = parsedHeader.from[0];
              emailDate = parsedHeader.date[0];
              logger.info(`Email from ${emailFrom} with date ${emailDate}`);
            });
          });

          msg.once('attributes', function (attrs) {
            const attachments = findAttachmentParts(attrs.struct);
            logger.debug(prefix + 'Has attachments: %d', attachments.length);
            logger.info(`Email with ${attachments.length} attachments`);
            for (let i = 0, len = attachments.length; i < len; ++i) {
              const attachment = attachments[i];

              if (attachment.params.name.endsWith('.pdf')) {
                logger.debug(
                  prefix + 'Fetching PDF attachment %s',
                  attachment.params.name
                );
                const f = imap.fetch(attrs.uid, {
                  bodies: [attachment.partID],
                  struct: true,
                });

                f.on(
                  'message',
                  buildAttMessageFunction(attachment, emailFrom, emailDate)
                );
              }
            }
          });

          msg.once('end', function () {
            logger.debug(prefix + 'Finished email');
          });
        });

        f.once('error', function (err) {
          logger.error('Fetch error: ' + err);
        });

        f.once('end', function () {
          logger.info('Done fetching all messages!');
          imap.end();
        });
      }
    });
  });
});

imap.once('error', function (err) {
  logger.error(err);
});

imap.once('end', function () {
  logger.info('Connection ended');
});

imap.connect();
