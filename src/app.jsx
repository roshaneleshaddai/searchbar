
import './app.css'
import Index from './components/AdvancedSearch/index.jsx'   

export function App() {
  
  const loggedUser = {
    Zuid: '60065086095',
    full_name: 'Matta Eleshaddai Roshan',
    email: 'eleshaddai.m@zohointern.com',
    display_name: 'Matta Roshan',
    avatar_url: 'https://cdn.zulip.com/avatars/60065086095/1c8e7b9c8e5a0fbbd2b4c3a9e6f1c8.png',
  }; 

  return (
    <>
      <div>
        <Index loggedUser={loggedUser} />
       </div>
    </>
  )
}
