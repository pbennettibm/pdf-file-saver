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
  config.logs.simpleNodeLogger
);

logger.setLevel(config.logs?.level || 'debug');

const checkMail = () => {
  const formatFilename = (filename, emailFrom, emailDate) => {
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
  };

  const findAttachmentParts = (struct, attachments) => {
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
  };

  const buildAttMessage = (attachment, actualFileName) => {
    const filename = attachment.params.name;
    const encoding = attachment.encoding;

    return (msg, seqno) => {
      const prefix = '(#' + seqno + ') ';
      msg.on('body', (stream, info) => {
        logger.debug(
          prefix + 'Streaming this attachment to file',
          filename,
          info
        );
        const writeStream = fs.createWriteStream(actualFileName);

        writeStream.on('finish', () => {
          logger.debug(prefix + 'Done writing to file %s', actualFileName);
        });

        if (encoding.toLowerCase() === 'base64') {
          stream.pipe(new Base64Decode()).pipe(writeStream);
        } else {
          stream.pipe(writeStream);
        }
      });

      msg.once('end', () => {
        logger.debug(prefix + 'Finished attachment %s', filename);
        logger.info(`PDF attachment downloaded: ${actualFileName}`);
      });
    };
  };

  imap.once('ready', () => {
    logger.info('Connected');
    imap.openBox('INBOX', !markAsRead, (err, box) => {
      if (err) throw err;

      imap.search(['UNSEEN'], (err, results) => {
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

          f.on('message', (msg, seqno) => {
            logger.debug('Message #%d', seqno);
            const prefix = '(#' + seqno + ') ';
            let emailDate;
            let emailFrom;

            msg.on('body', (stream, info) => {
              let buffer = '';
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
              stream.once('end', () => {
                const parsedHeader = Imap.parseHeader(buffer);
                logger.debug(prefix + 'Parsed header: %s', parsedHeader);
                emailFrom = parsedHeader.from[0];
                emailDate = parsedHeader.date[0];
                logger.info(`Email from ${emailFrom} with date ${emailDate}`);
              });
            });

            msg.once('attributes', (attrs) => {
              const attachments = findAttachmentParts(attrs.struct);
              logger.debug(prefix + 'Has attachments: %d', attachments.length);
              logger.info(`Email with ${attachments.length} attachments`);
              for (let i = 0, len = attachments.length; i < len; ++i) {
                const attachment = attachments[i];
                const filename = attachment.params.name;
                const actualFileName = formatFilename(
                  filename,
                  emailFrom,
                  emailDate
                );

                if (
                  attachment.params.name.endsWith('.pdf') &&
                  !fs.existsSync(actualFileName)
                ) {
                  logger.debug(
                    prefix + 'Fetching PDF attachment %s',
                    attachment.params.name
                  );
                  const f = imap.fetch(attrs.uid, {
                    bodies: [attachment.partID],
                    struct: true,
                  });

                  f.on('message', buildAttMessage(attachment, actualFileName));
                }
              }
            });

            msg.once('end', () => {
              logger.debug(prefix + 'Finished email');
            });
          });

          f.once('error', (err) => {
            logger.error('Fetch error: ' + err);
          });

          f.once('end', () => {
            logger.info('Done fetching all messages!');
            imap.end();
          });
        }
      });
    });
  });

  imap.once('error', (err) => {
    logger.error(err);
  });

  imap.once('end', () => {
    logger.info('Connection ended');
  });

  imap.connect();
};

setInterval(() => checkMail(), 20000);
