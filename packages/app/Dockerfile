FROM node:14.17.0

WORKDIR /app

COPY yarn.lock yarn.lock
COPY package.json package.json
RUN yarn --frozen-lockfile

COPY . .

CMD ["yarn", "start"]
