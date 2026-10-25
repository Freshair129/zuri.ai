import base from '/app/vitest.config.js';
export default {...base,test:{...base.test,include:['experiment/native.test.js'],testTimeout:1200000,hookTimeout:1200000,fileParallelism:false}};
