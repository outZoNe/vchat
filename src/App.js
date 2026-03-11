import AppLayout from './components/AppLayout';
import './index.css';
import { useGlobalToast } from './utils/helper';
import { useSignalingListener } from './hooks/useSignalingListener';

const App = ({ children }) => {
  useGlobalToast();
  useSignalingListener();
  return <AppLayout>{children}</AppLayout>;
};

export default App;
