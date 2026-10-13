# Specify the base Docker image. You can read more about
# the available Docker images at https://docs.apify.com/sdk/js/#apify-docker-images
FROM apify/actor-node:20

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (including dev) so we can compile TypeScript
RUN npm --quiet set progress=false \
    && npm install \
    && echo "Installed NPM packages:" \
    && (npm list --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Copy source and build
COPY . ./
RUN npm run build \
    && npm prune --omit=dev \
    && rm -r ~/.npm

CMD npm run start:prod --silent
