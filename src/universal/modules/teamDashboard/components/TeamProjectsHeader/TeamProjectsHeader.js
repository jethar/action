import React, {PropTypes} from 'react';
import look, {StyleSheet} from 'react-look';
import {DashPanelHeading} from 'universal/components/Dashboard';
import FontAwesome from 'react-fontawesome';
import {Link} from 'react-router';

const TeamProjectsHeader = (props) => {
  const {teamId} = props;
  const {styles} = TeamProjectsHeader;
  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        <DashPanelHeading icon="check" label="Team Projects" />
      </div>
      <div className={styles.controls}>
        <Link to={`/team/${teamId}/archive`}>
          See Archived Items
          <FontAwesome name="archive" />
        </Link>
        <span>Show by team member: ALL TEAM MEMBERS</span>
      </div>
    </div>
  );
};

TeamProjectsHeader.propTypes = {
  // TODO
  children: PropTypes.any
};

TeamProjectsHeader.styles = StyleSheet.create({
  root: {
    display: 'flex',
    flex: 1,
    // padding: '1rem',
    width: '100%'
  },

  heading: {
    // display: 'none'
  },

  controls: {
    flex: 1,
    textAlign: 'right'
  }
});

export default look(TeamProjectsHeader);
