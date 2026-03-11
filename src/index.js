import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ChakraProvider } from '@chakra-ui/react';
import App from './App';
import store from './store/store';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode>
  <ChakraProvider>
    <Provider store={store}>
      <App />
    </Provider>
  </ChakraProvider>
</React.StrictMode>);
