FROM node:20-alpine

# Install OpenSSL and other dependencies required by Prisma
RUN apk add --no-cache openssl openssl-dev libc6-compat

# Create app directory
WORKDIR /usr/src/app

COPY . .

RUN npm install && \
    npm run prisma:prod:generate

EXPOSE $PORT
# necessary for small machines on fly.io to avoid crashing during npm install
ENV NODE_OPTIONS=--max_old_space_size=4096
CMD ["npm", "run", "dev"]