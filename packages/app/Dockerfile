FROM node:14.17.0-alpine

WORKDIR /app

COPY yarn.lock yarn.lock
COPY package.json package.json
RUN yarn --frozen-lockfile --production && yarn cache clean

COPY . .

CMD ["yarn", "start"]
