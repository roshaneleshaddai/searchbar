import { render } from 'preact'
import './index.css'
import { App } from './app.jsx'
import { Provider } from 'react-redux'
import { store } from './components/AdvancedSearch/store/store'

render(
<Provider store={store}>
  <App />
</Provider>, document.getElementById('app'))
