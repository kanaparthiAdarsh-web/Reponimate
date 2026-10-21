# tinyqueue-lite

> A tiny priority queue for JavaScript

Fast enough for most scheduling tasks and small enough to read in one sitting.

## Install

```sh
npm install tinyqueue-lite
```

## Usage

```js
import { PriorityQueue } from 'tinyqueue-lite';
const q = new PriorityQueue();
q.push(5);
```

## Features

- Binary heap storage
- Custom comparator
