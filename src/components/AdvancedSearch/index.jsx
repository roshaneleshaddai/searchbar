import React from 'react'
import AdvancedSearch from './ui/AdvancedSearch'
import { mockData } from './mock/clientmockData'

const index = ({ loggedUser }) => {
  const clientData = {
    chats: mockData.chats || [], 
    users: mockData.users || [], 
  };
  
  // We pass just the names of modules we want enabled
  const enabledModules = ['users', 'chats', 'channels', 'messages', 'files', 'department', 'bots', 'threads', 'widgets', 'apps', 'connections', 'settings'];

  return (
    <div>
      <AdvancedSearch 
        context="home"
        clientData={clientData}
        moduleApis={enabledModules}
        onSelect={(item) => {
          console.log('Selected:', item);
          
        }}
        loggedUser={loggedUser}
      />
    </div>
  )
}

export default index